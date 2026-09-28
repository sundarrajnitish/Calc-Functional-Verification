// =============================================================================
//  calc3_tb_top.sv -- Calc3 testbench top
//  Author: Nitish Sundarraj
//
//  Plusargs: +TEST=<smoke|directed|hazards|random|regress>  +N=<count>  +SEED=<n>
//  Parameter: BUG=<0..7> selects the injected defect in the open reference DUT
// =============================================================================
`timescale 1ns/1ps

module calc3_tb_top;
    import calc3_pkg::*;

    parameter int BUG = 0;

    logic c_clk = 1'b0;
    always #20 c_clk = ~c_clk;          // 25 MHz, as in the 2024 environment

    calc3_if bus (c_clk);
    logic scan_out;

    calc3_top #(.BUG(BUG)) dut (
        .a_clk(1'b0), .b_clk(1'b0), .c_clk(c_clk),    // LSSD scan clocks held low
        .reset(bus.reset), .scan_in(1'b0), .scan_out(scan_out),
        .req1_cmd(bus.cmd[1]), .req1_d1(bus.d1[1]), .req1_d2(bus.d2[1]), .req1_r1(bus.r1[1]), .req1_tag(bus.tag[1]), .req1_data(bus.data[1]),
        .req2_cmd(bus.cmd[2]), .req2_d1(bus.d1[2]), .req2_d2(bus.d2[2]), .req2_r1(bus.r1[2]), .req2_tag(bus.tag[2]), .req2_data(bus.data[2]),
        .req3_cmd(bus.cmd[3]), .req3_d1(bus.d1[3]), .req3_d2(bus.d2[3]), .req3_r1(bus.r1[3]), .req3_tag(bus.tag[3]), .req3_data(bus.data[3]),
        .req4_cmd(bus.cmd[4]), .req4_d1(bus.d1[4]), .req4_d2(bus.d2[4]), .req4_r1(bus.r1[4]), .req4_tag(bus.tag[4]), .req4_data(bus.data[4]),
        .out1_resp(bus.out_resp[1]), .out1_tag(bus.out_tag[1]), .out1_data(bus.out_data[1]),
        .out2_resp(bus.out_resp[2]), .out2_tag(bus.out_tag[2]), .out2_data(bus.out_data[2]),
        .out3_resp(bus.out_resp[3]), .out3_tag(bus.out_tag[3]), .out3_data(bus.out_data[3]),
        .out4_resp(bus.out_resp[4]), .out4_tag(bus.out_tag[4]), .out4_data(bus.out_data[4])
    );

    calc3_env   env;
    calc3_tests tests;

    initial begin
        string test = "regress";
        int unsigned n, seed;
        string cov_json;
        real cov_pct;

        void'($value$plusargs("TEST=%s", test));
        if ($value$plusargs("SEED=%d", seed)) process::self().srandom(seed);
        env   = new(bus);
        tests = new(env);
        if ($value$plusargs("N=%d", n)) tests.n_random = n;

        $display("==============================================================");
        $display(" Calc3 verification  test=%s  BUG=%0d", test, BUG);
        $display("==============================================================");

        env.apply_reset(8);
        env.run_bfm();

        if (test == "smoke"    || test == "regress") tests.smoke();
        if (test == "directed" || test == "regress") tests.directed();
        if (test == "hazards"  || test == "regress") tests.hazards();
        if (test == "random"   || test == "regress") tests.random_traffic();

        cov_pct = env.cov.report(cov_json);
        $display("--------------------------------------------------------------");
        $display(" checked=%0d pass=%0d fail=%0d  coverage=%0.1f%%",
                 env.n_checked, env.n_pass, env.n_fail, cov_pct);
        $display(" RESULT: %s", (env.n_fail == 0) ? "PASS" : "FAIL");
        $display("@@SUMMARY {\"design\":\"calc3\",\"test\":\"%s\",\"bug\":%0d,\"checked\":%0d,\"pass\":%0d,\"fail\":%0d,\"spurious\":0,\"coverage\":%0.2f,\"cov\":{%s},\"fail_kinds\":%s,\"fail_cmds\":%s,\"first_fail\":\"%s\"}",
                 test, BUG, env.n_checked, env.n_pass, env.n_fail, cov_pct, cov_json,
                 env.map_json(env.fail_by_kind), env.map_json(env.fail_by_cmd), env.first_fail);
        $finish;
    end

    initial begin
        #50ms;
        $display("[FATAL] global watchdog expired");
        $finish;
    end
endmodule
