// =============================================================================
//  calc1_top.v  --  Open reference model of the Calc1 four-port calculator
// -----------------------------------------------------------------------------
//  Author : Nitish Sundarraj
//  Project: Calc-Functional-Verification (COEN 6541, revisited 2026)
//
//  A clean-room, readable Verilog-2005 implementation of the Calc1 spec used
//  in the COEN 6541 functional-verification labs. The course ships the real
//  design as encrypted IP that only runs in Questa; this model has the SAME
//  port list and protocol so the testbenches in tb/calc1 run unchanged on
//  either one -- and on free simulators (Icarus Verilog, Verilator).
//
//  Protocol (per port N = 1..4)
//    cycle T   : reqN_cmd_in = command, reqN_data_in = operand 1
//    cycle T+1 : reqN_cmd_in = 0,       reqN_data_in = operand 2
//    later     : out_respN != 0 for exactly one cycle, out_dataN = result
//    One outstanding command per port; wait for the response before the next.
//
//  Commands              Responses
//    0 : no-op             0 : no response this cycle
//    1 : add  op1 + op2    1 : success, out_data valid
//    2 : sub  op1 - op2    2 : overflow / underflow / invalid command
//    5 : shl  op1 << op2   3 : unused (internal error)
//    6 : shr  op1 >> op2
//    shift amount = op2[27:31]  (the 5 least-significant bits)
//
//  Micro-architecture
//    * 4 input stages (IDLE -> OP2 -> PEND)
//    * 2 execution units, each a 3-stage pipeline: ADD (add/sub), SHIFT (shl/shr)
//    * fixed-priority arbitration per unit: port 1 > port 2 > port 3 > port 4
//    * invalid commands are answered directly (response 2) by the arbiter
//    * reset[1:7] non-zero holds the whole design in reset (spec: all ones for
//      at least 7 cycles)
//
//  Bit numbering follows the IBM convention: bit 0 is the MSB.
//
//  Bug injection (for teaching / mutation testing)
//    parameter BUG selects ONE deliberately injected defect (0 = golden).
//    See docs/ or README for the catalogue. Bugs 1-4 reproduce the failure
//    signatures observed on the course DUT in the 2024 Questa campaign;
//    bugs 5-7 are classic arbitration / protocol defects added for teaching.
// =============================================================================
`timescale 1ns/1ps

module calc1_top #(
    parameter integer BUG = 0
) (
    input  wire        c_clk,
    input  wire [1:7]  reset,

    input  wire [0:3]  req1_cmd_in,  input  wire [0:31] req1_data_in,
    input  wire [0:3]  req2_cmd_in,  input  wire [0:31] req2_data_in,
    input  wire [0:3]  req3_cmd_in,  input  wire [0:31] req3_data_in,
    input  wire [0:3]  req4_cmd_in,  input  wire [0:31] req4_data_in,

    output reg  [0:1]  out_resp1,    output reg  [0:31] out_data1,
    output reg  [0:1]  out_resp2,    output reg  [0:31] out_data2,
    output reg  [0:1]  out_resp3,    output reg  [0:31] out_data3,
    output reg  [0:1]  out_resp4,    output reg  [0:31] out_data4
);

    // ------------------------------------------------------------------ consts
    localparam [0:3] CMD_NOP = 4'd0, CMD_ADD = 4'd1, CMD_SUB = 4'd2,
                     CMD_SHL = 4'd5, CMD_SHR = 4'd6;
    localparam [0:1] RSP_NONE = 2'd0, RSP_OK = 2'd1, RSP_ERR = 2'd2;
    localparam [1:0] ST_IDLE = 2'd0, ST_OP2 = 2'd1, ST_PEND = 2'd2, ST_BUSY = 2'd3;

    localparam integer BUG_ADD_OP2_BRIDGE  = 1; // port1 ADD: op2 bits 4 & 5 shorted
    localparam integer BUG_SUB_P1_ZERO     = 2; // port1 SUB: result stuck at 0
    localparam integer BUG_SHL_BY_ZERO_X   = 3; // SHL by 0 drives X on every '1' bit
    localparam integer BUG_SHR_SMALL_AMT   = 4; // SHR by 0 -> 0, SHR by 1 -> no shift
    localparam integer BUG_ADD_OVF_MISSED  = 5; // carry-out not reported
    localparam integer BUG_PRIO_STARVE     = 6; // port4 request lost when port1 wins
    localparam integer BUG_INVALID_SILENT  = 7; // invalid command never answered

    wire in_reset = |reset;

    // ------------------------------------------------------------ input stage
    reg [1:0]  st   [1:4];
    reg [0:3]  cmd  [1:4];
    reg [0:31] op1  [1:4];
    reg [0:31] op2  [1:4];

    wire [0:3]  cmd_in  [1:4];
    wire [0:31] data_in [1:4];
    assign cmd_in[1] = req1_cmd_in;  assign data_in[1] = req1_data_in;
    assign cmd_in[2] = req2_cmd_in;  assign data_in[2] = req2_data_in;
    assign cmd_in[3] = req3_cmd_in;  assign data_in[3] = req3_data_in;
    assign cmd_in[4] = req4_cmd_in;  assign data_in[4] = req4_data_in;

    function is_add_unit;  input [0:3] c; is_add_unit = (c == CMD_ADD) || (c == CMD_SUB); endfunction
    function is_shf_unit;  input [0:3] c; is_shf_unit = (c == CMD_SHL) || (c == CMD_SHR); endfunction

    // ------------------------------------------------------------ arbitration
    // Combinational: which port wins each unit this cycle, and which pending
    // invalid command (if any) is answered this cycle.
    reg [2:0] add_win, shf_win, inv_win;   // 0 = none, 1..4 = port
    integer p;
    always @* begin
        add_win = 0; shf_win = 0; inv_win = 0;
        for (p = 4; p >= 1; p = p - 1) begin           // descending => port 1 wins
            if (st[p] == ST_PEND) begin
                if (is_add_unit(cmd[p]))      add_win = p[2:0];
                else if (is_shf_unit(cmd[p])) shf_win = p[2:0];
                else                          inv_win = p[2:0];
            end
        end
    end

    // BUG 6: a port-4 request that loses arbitration to port 1 is silently
    // dropped (its state machine is released without ever being executed).
    wire drop_p4 = (BUG == BUG_PRIO_STARVE) && (st[4] == ST_PEND) &&
                   ((is_add_unit(cmd[4]) && add_win == 1) ||
                    (is_shf_unit(cmd[4]) && shf_win == 1));

    // ----------------------------------------------------- operand-2 bridging
    // BUG 1: in the port-1 adder path, the operand-2 bit-4 net is shorted to
    // the bit-5 net (LSB-0 numbering; [27] and [26] in IBM numbering). In a
    // 4-state simulator the two drivers fight and bit 4 becomes X whenever the
    // bits differ; the ripple-carry adder below then smears that X over the
    // following bits exactly as far as the carry can propagate. This model
    // reproduces all 3321 port-1 ADD results in the 2024 Questa log digit for
    // digit (see sim/check_replay.py). Verilator is 2-state, so there the
    // bridge is modelled as a wired-AND, the usual bridging-fault model.
    wire [0:31] add_b_p1;
`ifdef VERILATOR
    wire bridge_net = op2[1][27] & op2[1][26];
`else
    wire bridge_net;
    assign bridge_net = (BUG == BUG_ADD_OP2_BRIDGE) ? op2[1][27] : 1'bz;
    assign bridge_net = (BUG == BUG_ADD_OP2_BRIDGE) ? op2[1][26] : 1'bz;
`endif
    assign add_b_p1 = (BUG == BUG_ADD_OP2_BRIDGE)
                    ? {op2[1][0:26], bridge_net, op2[1][28:31]}
                    : op2[1];

    // Ripple-carry adder written with bit-wise gates, so unknown (X) inputs
    // propagate the way they do through real logic instead of turning the whole
    // word into X (which is what a behavioural '+' does in 4-state simulators).
    function [0:32] ripple_add;          // {carry_out, sum[0:31]}
        input [0:31] x, y;
        input        cin;
        integer i;
        reg c, pr;
        begin
            c = cin;
            ripple_add = 33'd0;
            for (i = 31; i >= 0; i = i - 1) begin
                pr = x[i] ^ y[i];
                ripple_add[i + 1] = pr ^ c;
                c = (x[i] & y[i]) | (c & pr);
            end
            ripple_add[0] = c;
        end
    endfunction

    // ------------------------------------------------------ execution units
    // Stage 0 (issue) computes the result; stages 1-2 are pure delay, which
    // models the multi-cycle latency of the real design.
    reg        a_v   [0:2];  reg [2:0] a_port [0:2];
    reg [0:1]  a_rsp [0:2];  reg [0:31] a_dat [0:2];
    reg        s_v   [0:2];  reg [2:0] s_port [0:2];
    reg [0:1]  s_rsp [0:2];  reg [0:31] s_dat [0:2];

    // ADD unit result for the winning port
    reg [0:32] add_full;         // 33 bits: [0] = carry / borrow
    reg [0:31] a_op1, a_op2;
    reg [0:1]  add_rsp;
    reg [0:31] add_dat;
    always @* begin
        a_op1 = (add_win != 0) ? op1[add_win] : 32'd0;
        a_op2 = (add_win == 1) ? add_b_p1 : ((add_win != 0) ? op2[add_win] : 32'd0);
        add_rsp = RSP_OK;
        add_dat = 32'd0;
        if (add_win != 0) begin
            if (cmd[add_win] == CMD_ADD) begin
                add_full = ripple_add(a_op1, a_op2, 1'b0);
                if (add_full[0] === 1'b1 && BUG != BUG_ADD_OVF_MISSED) add_rsp = RSP_ERR;
                else                                                  add_dat = add_full[1:32];
            end else begin                                     // SUB = a + ~b + 1
                add_full = ripple_add(a_op1, ~a_op2, 1'b1);
                if (BUG == BUG_SUB_P1_ZERO && add_win == 1)   add_dat = 32'd0;
                else if (add_full[0] === 1'b0)                 add_rsp = RSP_ERR;   // borrow
                else                                           add_dat = add_full[1:32];
            end
        end else begin
            add_full = 33'd0;
        end
    end

    // SHIFT unit result for the winning port
    reg [0:31] s_op1;
    reg [0:4]  s_amt;
    reg [0:31] shf_dat;
    always @* begin
        s_op1 = (shf_win != 0) ? op1[shf_win] : 32'd0;
        s_amt = (shf_win != 0) ? op2[shf_win][27:31] : 5'd0;
        shf_dat = 32'd0;
        if (shf_win != 0) begin
            if (cmd[shf_win] == CMD_SHL) begin
                if (BUG == BUG_SHL_BY_ZERO_X && s_amt == 5'd0) shf_dat = s_op1 & 32'bx;  // un-driven select: X where op1=1
                else                                            shf_dat = s_op1 << s_amt;
            end else begin
                if (BUG == BUG_SHR_SMALL_AMT && s_amt == 5'd0)      shf_dat = 32'd0;
                else if (BUG == BUG_SHR_SMALL_AMT && s_amt == 5'd1) shf_dat = s_op1;
                else                                                shf_dat = s_op1 >> s_amt;
            end
        end
    end

    // ------------------------------------------------------ sequential logic
    integer n;
    always @(posedge c_clk) begin
        if (in_reset) begin
            for (n = 1; n <= 4; n = n + 1) begin
                st[n] <= ST_IDLE; cmd[n] <= 4'd0; op1[n] <= 32'd0; op2[n] <= 32'd0;
            end
            for (n = 0; n <= 2; n = n + 1) begin
                a_v[n] <= 1'b0; a_port[n] <= 3'd0; a_rsp[n] <= 2'd0; a_dat[n] <= 32'd0;
                s_v[n] <= 1'b0; s_port[n] <= 3'd0; s_rsp[n] <= 2'd0; s_dat[n] <= 32'd0;
            end
            out_resp1 <= 0; out_resp2 <= 0; out_resp3 <= 0; out_resp4 <= 0;
            out_data1 <= 0; out_data2 <= 0; out_data3 <= 0; out_data4 <= 0;
        end else begin
            // ---- input stages
            for (n = 1; n <= 4; n = n + 1) begin
                case (st[n])
                    ST_IDLE: if (cmd_in[n] != CMD_NOP) begin
                                 cmd[n] <= cmd_in[n]; op1[n] <= data_in[n]; st[n] <= ST_OP2;
                             end
                    ST_OP2:  begin op2[n] <= data_in[n]; st[n] <= ST_PEND; end
                    ST_PEND: if (add_win == n[2:0] || shf_win == n[2:0] || inv_win == n[2:0])
                                 st[n] <= ST_BUSY;             // dispatched
                    ST_BUSY: ;                                  // wait for response
                endcase
            end
            if (drop_p4) st[4] <= ST_IDLE;                      // BUG 6

            // ---- execution pipelines
            a_v[0] <= (add_win != 0); a_port[0] <= add_win; a_rsp[0] <= add_rsp; a_dat[0] <= add_dat;
            s_v[0] <= (shf_win != 0); s_port[0] <= shf_win; s_rsp[0] <= RSP_OK;  s_dat[0] <= shf_dat;
            for (n = 1; n <= 2; n = n + 1) begin
                a_v[n] <= a_v[n-1]; a_port[n] <= a_port[n-1]; a_rsp[n] <= a_rsp[n-1]; a_dat[n] <= a_dat[n-1];
                s_v[n] <= s_v[n-1]; s_port[n] <= s_port[n-1]; s_rsp[n] <= s_rsp[n-1]; s_dat[n] <= s_dat[n-1];
            end

            // ---- output stage: default no response
            out_resp1 <= RSP_NONE; out_resp2 <= RSP_NONE; out_resp3 <= RSP_NONE; out_resp4 <= RSP_NONE;
            out_data1 <= 32'd0;    out_data2 <= 32'd0;    out_data3 <= 32'd0;    out_data4 <= 32'd0;

            if (a_v[2]) respond(a_port[2], a_rsp[2], a_dat[2]);
            if (s_v[2]) respond(s_port[2], s_rsp[2], s_dat[2]);
            if (inv_win != 0 && BUG != BUG_INVALID_SILENT) respond(inv_win, RSP_ERR, 32'd0);
            if (inv_win != 0 && BUG == BUG_INVALID_SILENT) st[inv_win] <= ST_BUSY; // hangs
        end
    end

    // Drive one port's response registers and release its input stage.
    // (Each port has at most one command in flight, so no collisions.)
    task respond;
        input [2:0]  port;
        input [0:1]  rsp;
        input [0:31] dat;
        begin
            case (port)
                3'd1: begin out_resp1 <= rsp; out_data1 <= dat; end
                3'd2: begin out_resp2 <= rsp; out_data2 <= dat; end
                3'd3: begin out_resp3 <= rsp; out_data3 <= dat; end
                3'd4: begin out_resp4 <= rsp; out_data4 <= dat; end
                default: ;
            endcase
            if (port != 0) st[port] <= ST_IDLE;
        end
    endtask

endmodule
