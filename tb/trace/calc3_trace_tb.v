// Cycle trace harness for Calc3 (see calc1_trace_tb.v). -- Nitish Sundarraj
`timescale 1ns/1ps
module calc3_trace_tb;
    parameter integer BUG = 0;
    reg c_clk = 0; always #5 c_clk = ~c_clk;
    reg rst;
    reg [0:3] c [1:4], a [1:4], b [1:4], r [1:4]; reg [0:1] t [1:4]; reg [0:31] d [1:4];
    wire [0:1] rp [1:4], tg [1:4]; wire [0:31] od [1:4]; wire so;
    calc3_top #(.BUG(BUG)) dut (.a_clk(1'b0), .b_clk(1'b0), .c_clk(c_clk), .reset(rst), .scan_in(1'b0), .scan_out(so),
        .req1_cmd(c[1]), .req1_d1(a[1]), .req1_d2(b[1]), .req1_r1(r[1]), .req1_tag(t[1]), .req1_data(d[1]),
        .req2_cmd(c[2]), .req2_d1(a[2]), .req2_d2(b[2]), .req2_r1(r[2]), .req2_tag(t[2]), .req2_data(d[2]),
        .req3_cmd(c[3]), .req3_d1(a[3]), .req3_d2(b[3]), .req3_r1(r[3]), .req3_tag(t[3]), .req3_data(d[3]),
        .req4_cmd(c[4]), .req4_d1(a[4]), .req4_d2(b[4]), .req4_r1(r[4]), .req4_tag(t[4]), .req4_data(d[4]),
        .out1_resp(rp[1]), .out1_tag(tg[1]), .out1_data(od[1]), .out2_resp(rp[2]), .out2_tag(tg[2]), .out2_data(od[2]),
        .out3_resp(rp[3]), .out3_tag(tg[3]), .out3_data(od[3]), .out4_resp(rp[4]), .out4_tag(tg[4]), .out4_data(od[4]));
    integer fd, n, p; reg [8*256-1:0] fname;
    reg [0:3] tc, ta, tb, tr; reg [0:1] tt; reg [0:31] td;
    initial begin
        if (!$value$plusargs("STIM=%s", fname)) $finish;
        fd = $fopen(fname, "r");
        while (!$feof(fd)) begin
            n = $fscanf(fd, "%h", rst);
            if (n == 1) begin
                for (p = 1; p <= 4; p = p + 1) begin
                    n = $fscanf(fd, " %h %h %h %h %h %h", tc, ta, tb, tr, tt, td);
                    c[p] = tc; a[p] = ta; b[p] = tb; r[p] = tr; t[p] = tt; d[p] = td;
                end
                @(posedge c_clk); #1;
                $display("%h %h %h %h %h %h %h %h %h %h %h %h", rp[1], tg[1], od[1], rp[2], tg[2], od[2], rp[3], tg[3], od[3], rp[4], tg[4], od[4]);
                @(negedge c_clk);
            end
        end
        $finish;
    end
endmodule
