// Cycle trace harness: applies one stimulus line per cycle, prints the DUT
// outputs after every rising edge. Used by sim/check_js_models.py to prove the
// website's JavaScript model is cycle-identical to the RTL. -- Nitish Sundarraj
`timescale 1ns/1ps
module calc1_trace_tb;
    parameter integer BUG = 0;
    reg c_clk = 0; always #5 c_clk = ~c_clk;
    reg [1:7] rst; reg [0:3] c1, c2, c3, c4; reg [0:31] d1, d2, d3, d4;
    wire [0:1] r1, r2, r3, r4; wire [0:31] o1, o2, o3, o4;
    calc1_top #(.BUG(BUG)) dut (.c_clk(c_clk), .reset(rst),
        .req1_cmd_in(c1), .req1_data_in(d1), .req2_cmd_in(c2), .req2_data_in(d2),
        .req3_cmd_in(c3), .req3_data_in(d3), .req4_cmd_in(c4), .req4_data_in(d4),
        .out_resp1(r1), .out_data1(o1), .out_resp2(r2), .out_data2(o2),
        .out_resp3(r3), .out_data3(o3), .out_resp4(r4), .out_data4(o4));
    integer fd, n; reg [8*256-1:0] fname;
    initial begin
        if (!$value$plusargs("STIM=%s", fname)) $finish;
        fd = $fopen(fname, "r");
        while (!$feof(fd)) begin
            n = $fscanf(fd, "%h %h %h %h %h %h %h %h %h\n", rst, c1, d1, c2, d2, c3, d3, c4, d4);
            if (n == 9) begin
                @(posedge c_clk); #1;
                $display("%h %h %h %h %h %h %h %h", r1, o1, r2, o2, r3, o3, r4, o4);
                @(negedge c_clk);
            end
        end
        $finish;
    end
endmodule
