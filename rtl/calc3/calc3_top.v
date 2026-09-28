// =============================================================================
//  calc3_top.v  --  Open reference model of the Calc3 register-based calculator
// -----------------------------------------------------------------------------
//  Author : Nitish Sundarraj
//  Project: Calc-Functional-Verification (COEN 6541, revisited 2026)
//
//  Clean-room, port-compatible replacement for the encrypted course DUT.
//  Calc3 extends Calc1 with sixteen 32-bit registers, 2-bit tags (up to four
//  commands in flight per port), out-of-order responses, store/fetch and
//  conditional "branch" (skip-next) commands.
//
//  Request (one cycle, all fields together):
//    reqN_cmd, reqN_d1, reqN_d2, reqN_r1 (register indices), reqN_tag, reqN_data
//  Response (one cycle): outN_resp, outN_tag, outN_data
//
//   cmd | name  | effect                                   | out_data
//   ----+-------+------------------------------------------+-----------
//    0  | nop   | --                                       |
//    1  | add   | R[r1] = R[d1] + R[d2]   (carry -> resp 2) | 0
//    2  | sub   | R[r1] = R[d1] - R[d2]   (borrow -> resp 2)| 0
//    5  | shl   | R[r1] = R[d1] << R[d2][27:31]            | 0
//    6  | shr   | R[r1] = R[d1] >> R[d2][27:31]            | 0
//    9  | store | R[r1] = data                             | 0
//   10  | fetch | --                                       | R[d1]
//   12  | bz    | if R[d1] == 0     skip next cmd (port)   | 0
//   13  | be    | if R[d1] == R[d2] skip next cmd (port)   | 0
//   other       | invalid                                  | resp 2
//
//  Responses: 1 = success, 2 = overflow/underflow/invalid, 3 = skipped by a
//  taken branch (the skipped command has no architectural effect).
//  On resp 2 the destination register is NOT written.
//
//  Ordering model (this is what the testbench reference model assumes):
//    * every non-zero command is accepted the cycle it is presented;
//    * accepted commands take architectural effect in that cycle, in port
//      order 1 -> 4 (a port-2 fetch sees a port-1 store of the same cycle);
//    * the response appears after a class-dependent latency
//        store/fetch/branch/skip/invalid : 1 cycle
//        add/sub                         : 3 cycles
//        shl/shr                         : 4 cycles
//      so responses on one port can overtake each other -> tags matter;
//    * at most one response per port per cycle; the lowest ready tag wins.
//
//  a_clk / b_clk / scan_in / scan_out are the LSSD scan interface of the real
//  design. They are functionally unused here (hold a_clk=b_clk=0).
//
//  parameter BUG selects one injected defect (0 = golden), see README.
// =============================================================================
`timescale 1ns/1ps

module calc3_top #(
    parameter integer BUG = 0
) (
    /* verilator lint_off UNUSEDSIGNAL */
    input  wire        a_clk, b_clk,        // LSSD scan clocks (unused)
    input  wire        scan_in,             // scan chain input (unused)
    /* verilator lint_on UNUSEDSIGNAL */
    input  wire        c_clk,
    input  wire        reset,
    output wire        scan_out,

    input  wire [0:3]  req1_cmd, req1_d1, req1_d2, req1_r1,
    input  wire [0:1]  req1_tag, input wire [0:31] req1_data,
    input  wire [0:3]  req2_cmd, req2_d1, req2_d2, req2_r1,
    input  wire [0:1]  req2_tag, input wire [0:31] req2_data,
    input  wire [0:3]  req3_cmd, req3_d1, req3_d2, req3_r1,
    input  wire [0:1]  req3_tag, input wire [0:31] req3_data,
    input  wire [0:3]  req4_cmd, req4_d1, req4_d2, req4_r1,
    input  wire [0:1]  req4_tag, input wire [0:31] req4_data,

    output reg  [0:1]  out1_resp, out1_tag, output reg [0:31] out1_data,
    output reg  [0:1]  out2_resp, out2_tag, output reg [0:31] out2_data,
    output reg  [0:1]  out3_resp, out3_tag, output reg [0:31] out3_data,
    output reg  [0:1]  out4_resp, out4_tag, output reg [0:31] out4_data
);
    assign scan_out = 1'b0;

    localparam [0:3] C_NOP=0, C_ADD=1, C_SUB=2, C_SHL=5, C_SHR=6,
                     C_STORE=9, C_FETCH=10, C_BZ=12, C_BE=13;
    localparam [0:1] R_OK=1, R_ERR=2, R_SKIP=3;

    localparam integer BUG_TAG_STALE       = 1; // back-to-back responses reuse old tag
    localparam integer BUG_NO_XPORT_FWD    = 2; // same-cycle store->fetch across ports sees old value
    localparam integer BUG_SKIP_HAS_EFFECT = 3; // skipped command still writes its result
    localparam integer BUG_SHIFT_BY_INDEX  = 4; // shift amount = d2 field, not R[d2]
    localparam integer BUG_P4_NO_UNDERFLOW = 5; // port-4 sub underflow not flagged
    localparam integer BUG_P3_R15_DROP     = 6; // port-3 writes to R15 are lost
    localparam integer BUG_BE_LOW16        = 7; // branch-if-equal compares low 16 bits only

    // ----------------------------------------------------------- request bus
    wire [0:3]  q_cmd [1:4], q_d1 [1:4], q_d2 [1:4], q_r1 [1:4];
    wire [0:1]  q_tag [1:4];
    wire [0:31] q_dat [1:4];
    assign q_cmd[1]=req1_cmd; assign q_d1[1]=req1_d1; assign q_d2[1]=req1_d2; assign q_r1[1]=req1_r1; assign q_tag[1]=req1_tag; assign q_dat[1]=req1_data;
    assign q_cmd[2]=req2_cmd; assign q_d1[2]=req2_d1; assign q_d2[2]=req2_d2; assign q_r1[2]=req2_r1; assign q_tag[2]=req2_tag; assign q_dat[2]=req2_data;
    assign q_cmd[3]=req3_cmd; assign q_d1[3]=req3_d1; assign q_d2[3]=req3_d2; assign q_r1[3]=req3_r1; assign q_tag[3]=req3_tag; assign q_dat[3]=req3_data;
    assign q_cmd[4]=req4_cmd; assign q_d1[4]=req4_d1; assign q_d2[4]=req4_d2; assign q_r1[4]=req4_r1; assign q_tag[4]=req4_tag; assign q_dat[4]=req4_data;

    // ------------------------------------------------------------------ state
    reg [0:31] rf   [0:15];          // register file
    reg        skip [1:4];           // "skip next command" flag per port
    // completion slots, one per (port, tag)
    reg        sl_v   [0:15];        // index = (port-1)*4 + tag
    reg [2:0]  sl_cnt [0:15];
    reg [0:1]  sl_rsp [0:15];
    reg [0:31] sl_dat [0:15];
    reg [0:1]  last_tag [1:4];       // used only by BUG_TAG_STALE
    reg        last_v   [1:4];

    // ------------------------------------------------ combinational execute
    // Walk the four ports in priority order on a scratch copy of the file.
    reg [0:31] nrf [0:15];
    reg        nskip [1:4];
    reg        ex_v  [1:4];
    reg [0:1]  ex_rsp[1:4];
    reg [0:31] ex_dat[1:4];
    reg [2:0]  ex_lat[1:4];
    reg [0:31] va, vb, res;
    reg [0:32] wide;
    reg        wr;
    reg [0:3]  wreg;
    reg [0:4]  amt;
    integer    p, k;

    always @* begin
        va = 32'd0; vb = 32'd0; amt = 5'd0; wr = 1'b0; wreg = 4'd0; res = 32'd0; wide = 33'd0;
        for (k = 0; k < 16; k = k + 1) nrf[k] = rf[k];
        for (p = 1; p <= 4; p = p + 1) begin
            nskip[p] = skip[p]; ex_v[p] = 1'b0; ex_rsp[p] = 2'd0; ex_dat[p] = 32'd0; ex_lat[p] = 3'd1;
        end
        for (p = 1; p <= 4; p = p + 1) begin
            if (q_cmd[p] != C_NOP) begin
                ex_v[p] = 1'b1;
                // BUG 2: operands read from the start-of-cycle file (no forwarding
                // of writes made earlier in the same cycle by other ports)
                va  = (BUG == BUG_NO_XPORT_FWD) ? rf[q_d1[p]] : nrf[q_d1[p]];
                vb  = (BUG == BUG_NO_XPORT_FWD) ? rf[q_d2[p]] : nrf[q_d2[p]];
                amt = (BUG == BUG_SHIFT_BY_INDEX) ? {1'b0, q_d2[p]} : vb[27:31];
                wr = 1'b0; wreg = q_r1[p]; res = 32'd0; wide = 33'd0;
                ex_rsp[p] = R_OK;
                case (q_cmd[p])
                    C_ADD:   begin wide = {1'b0,va} + {1'b0,vb}; res = wide[1:32]; ex_lat[p] = 3'd3;
                                   if (wide[0]) ex_rsp[p] = R_ERR; else wr = 1'b1; end
                    C_SUB:   begin res = va - vb; ex_lat[p] = 3'd3;
                                   if (vb > va && !(BUG == BUG_P4_NO_UNDERFLOW && p == 4)) ex_rsp[p] = R_ERR;
                                   else wr = 1'b1; end
                    C_SHL:   begin res = va << amt; wr = 1'b1; ex_lat[p] = 3'd4; end
                    C_SHR:   begin res = va >> amt; wr = 1'b1; ex_lat[p] = 3'd4; end
                    C_STORE: begin res = q_dat[p]; wr = 1'b1; end
                    C_FETCH: begin ex_dat[p] = va; end
                    C_BZ, C_BE: ;
                    default: ex_rsp[p] = R_ERR;
                endcase
                if (skip[p] && nskip[p]) begin
                    // this command is the one after a taken branch: skip it
                    ex_rsp[p] = R_SKIP; ex_dat[p] = 32'd0; ex_lat[p] = 3'd1;
                    nskip[p]  = 1'b0;
                    if (BUG != BUG_SKIP_HAS_EFFECT) wr = 1'b0;
                end else if (q_cmd[p] == C_BZ) begin
                    nskip[p] = (va == 32'd0);
                end else if (q_cmd[p] == C_BE) begin
                    nskip[p] = (BUG == BUG_BE_LOW16) ? (va[16:31] == vb[16:31]) : (va == vb);
                end
                if (wr && !(BUG == BUG_P3_R15_DROP && p == 3 && wreg == 4'd15))
                    nrf[wreg] = res;
            end
        end
    end

    // ------------------------------------------------ response selection
    // For each port pick the lowest tag whose latency has elapsed.
    // slot index of (port 1..4, tag): {port-1, tag}; port 4 -> 2'b11 (mod-4 wrap)
    /* verilator lint_off UNUSEDSIGNAL */
    function [3:0] sidx;
        input [2:0] pt; input [1:0] tg;
        sidx = {pt[1:0] - 2'd1, tg};
    endfunction
    /* verilator lint_on UNUSEDSIGNAL */

    reg        rdy_v   [1:4];
    reg [1:0]  rdy_tag [1:4];
    integer    sp, st;
    always @* begin
        for (sp = 1; sp <= 4; sp = sp + 1) begin
            rdy_v[sp] = 1'b0; rdy_tag[sp] = 2'd0;
            for (st = 3; st >= 0; st = st - 1)
                if (sl_v[sidx(sp[2:0], st[1:0])] && sl_cnt[sidx(sp[2:0], st[1:0])] <= 3'd1) begin
                    rdy_v[sp] = 1'b1; rdy_tag[sp] = st[1:0];
                end
        end
    end

    // --------------------------------------------------------- sequential
    integer s, port, t;
    always @(posedge c_clk) begin
        if (reset) begin
            for (s = 0; s < 16; s = s + 1) begin
                rf[s] <= 32'd0; sl_v[s] <= 1'b0; sl_cnt[s] <= 3'd0; sl_rsp[s] <= 2'd0; sl_dat[s] <= 32'd0;
            end
            for (port = 1; port <= 4; port = port + 1) begin
                skip[port] <= 1'b0; last_tag[port] <= 2'd0; last_v[port] <= 1'b0;
            end
            out1_resp <= 0; out1_tag <= 0; out1_data <= 0;
            out2_resp <= 0; out2_tag <= 0; out2_data <= 0;
            out3_resp <= 0; out3_tag <= 0; out3_data <= 0;
            out4_resp <= 0; out4_tag <= 0; out4_data <= 0;
        end else begin
            for (s = 0; s < 16; s = s + 1) rf[s] <= nrf[s];
            for (port = 1; port <= 4; port = port + 1) skip[port] <= nskip[port];

            out1_resp <= 0; out1_tag <= 0; out1_data <= 0;
            out2_resp <= 0; out2_tag <= 0; out2_data <= 0;
            out3_resp <= 0; out3_tag <= 0; out3_data <= 0;
            out4_resp <= 0; out4_tag <= 0; out4_data <= 0;

            for (port = 1; port <= 4; port = port + 1) begin
                // 1) age every in-flight slot that is not yet ready
                for (t = 0; t < 4; t = t + 1)
                    if (sl_v[sidx(port[2:0], t[1:0])] && sl_cnt[sidx(port[2:0], t[1:0])] > 3'd1)
                        sl_cnt[sidx(port[2:0], t[1:0])] <= sl_cnt[sidx(port[2:0], t[1:0])] - 3'd1;
                // 2) emit the selected ready response
                if (rdy_v[port]) begin
                    sl_v[sidx(port[2:0], rdy_tag[port])] <= 1'b0;
                    drive_out(port[2:0], sl_rsp[sidx(port[2:0], rdy_tag[port])],
                              (BUG == BUG_TAG_STALE && last_v[port]) ? last_tag[port] : rdy_tag[port],
                              sl_dat[sidx(port[2:0], rdy_tag[port])]);
                    last_tag[port] <= rdy_tag[port];
                end
                last_v[port] <= rdy_v[port];
                // 3) allocate the slot of a newly accepted command (slot = tag)
                if (ex_v[port]) begin
                    sl_v  [sidx(port[2:0], q_tag[port])] <= 1'b1;
                    sl_cnt[sidx(port[2:0], q_tag[port])] <= ex_lat[port];
                    sl_rsp[sidx(port[2:0], q_tag[port])] <= ex_rsp[port];
                    sl_dat[sidx(port[2:0], q_tag[port])] <= ex_dat[port];
                end
            end
        end
    end

    task drive_out;
        input [2:0] pt; input [0:1] rsp; input [0:1] tg; input [0:31] dat;
        begin
            case (pt)
                1: begin out1_resp <= rsp; out1_tag <= tg; out1_data <= dat; end
                2: begin out2_resp <= rsp; out2_tag <= tg; out2_data <= dat; end
                3: begin out3_resp <= rsp; out3_tag <= tg; out3_data <= dat; end
                4: begin out4_resp <= rsp; out4_tag <= tg; out4_data <= dat; end
                default: ;
            endcase
        end
    endtask

endmodule
