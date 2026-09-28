// =============================================================================
//  calc1_replay_2024.v -- replay the 2024 port-1 sweeps on the reference DUT
//  Author: Nitish Sundarraj
//
//  Plain Verilog so it runs on Icarus (4-state), where the bridged-bit fault
//  shows up as X exactly like it did on the course DUT in Questa.
//  It re-issues the same operand sweeps the 2024 testbench used and prints the
//  results in the 2024 log format, so sim/check_replay.py can diff them line by
//  line against results/2024_questa/*.log.
//
//    iverilog -g2012 -P calc1_replay_2024.BUG=1 -o replay rtl/calc1/calc1_top.v \
//             tb/calc1/calc1_replay_2024.v && vvp -n replay +MODE=add
//    MODE = add   : a in 997..1000, b in 0..1000   (ADD, port 1)
//           shift : a in 0..20, s in 0..31          (SHL and SHR, port 1)
// =============================================================================
`timescale 1ns/1ps

module calc1_replay_2024;
    parameter integer BUG = 1;

    reg         c_clk = 1'b0;
    always #25 c_clk = ~c_clk;

    reg  [1:7]  reset;
    reg  [0:3]  cmd1;  reg [0:31] din1;
    wire [0:1]  resp1, resp2, resp3, resp4;
    wire [0:31] dout1, dout2, dout3, dout4;

    calc1_top #(.BUG(BUG)) dut (
        .c_clk(c_clk), .reset(reset),
        .req1_cmd_in(cmd1), .req1_data_in(din1),
        .req2_cmd_in(4'd0), .req2_data_in(32'd0),
        .req3_cmd_in(4'd0), .req3_data_in(32'd0),
        .req4_cmd_in(4'd0), .req4_data_in(32'd0),
        .out_resp1(resp1), .out_data1(dout1), .out_resp2(resp2), .out_data2(dout2),
        .out_resp3(resp3), .out_data3(dout3), .out_resp4(resp4), .out_data4(dout4));

    reg [0:31] result;
    reg [0:1]  rsp;
    integer    a, b, cycles;
    reg [8*8-1:0] mode;

    // issue one command on port 1 and wait for its response (drives on negedge,
    // so there is no race with the DUT's posedge sampling)
    task op;
        input [0:3] c; input [0:31] x, y;
        begin
            @(negedge c_clk); cmd1 = c; din1 = x;
            @(negedge c_clk); cmd1 = 4'd0; din1 = y;
            @(negedge c_clk); din1 = 32'd0;
            cycles = 0; rsp = 2'd0;
            while (rsp == 2'd0 && cycles < 50) begin
                @(posedge c_clk); #1; rsp = resp1; result = dout1; cycles = cycles + 1;
            end
        end
    endtask

    initial begin
        if (!$value$plusargs("MODE=%s", mode)) mode = "add";
        cmd1 = 0; din1 = 0; reset = 7'h7F;
        repeat (8) @(posedge c_clk);
        reset = 7'h00;
        if (mode == "add") begin
            for (a = 997; a <= 1000; a = a + 1)
                for (b = 0; b <= 1000; b = b + 1) begin
                    op(4'd1, a, b);
                    $display("ADD operation result: %h + %h = %h", a[31:0], b[31:0], result);
                end
        end else begin
            for (a = 0; a <= 20; a = a + 1)
                for (b = 0; b <= 31; b = b + 1) begin
                    op(4'd5, a, b);
                    $display("SLL %0d %0d %0d", a, b, result);
                end
            for (a = 0; a <= 20; a = a + 1)
                for (b = 0; b <= 31; b = b + 1) begin
                    op(4'd6, a, b);
                    $display("SRL %0d %0d %0d", a, b, result);
                end
        end
        $finish;
    end
endmodule
