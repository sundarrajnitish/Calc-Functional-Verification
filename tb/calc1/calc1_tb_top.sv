// =============================================================================
//  calc1_tb_top.sv -- Calc1 testbench top
//  Author: Nitish Sundarraj
//
//  Plusargs
//    +TEST=<smoke|directed|priority|random|regress>   (default regress)
//    +N=<count>        number of random transactions  (default 2000)
//    +SEED=<n>         random seed (Verilator: also pass +verilator+seed+<n>)
//  Parameter
//    BUG=<0..7>        which injected defect the reference DUT carries
//                      (ignored by the encrypted course DUT)
// =============================================================================
`timescale 1ns/1ps

module calc1_tb_top;
    import calc1_pkg::*;

    parameter int BUG = 0;

    // 20 MHz clock (test plan operating assumption) -> 50 ns period
    logic c_clk = 1'b0;
    always #25 c_clk = ~c_clk;

    calc1_if bus (c_clk);

    calc1_top #(.BUG(BUG)) dut (
        .c_clk        (c_clk),
        .reset        (bus.reset),
        .req1_cmd_in  (bus.cmd[1]), .req1_data_in (bus.din[1]),
        .req2_cmd_in  (bus.cmd[2]), .req2_data_in (bus.din[2]),
        .req3_cmd_in  (bus.cmd[3]), .req3_data_in (bus.din[3]),
        .req4_cmd_in  (bus.cmd[4]), .req4_data_in (bus.din[4]),
        .out_resp1    (bus.resp[1]), .out_data1   (bus.dout[1]),
        .out_resp2    (bus.resp[2]), .out_data2   (bus.dout[2]),
        .out_resp3    (bus.resp[3]), .out_data3   (bus.dout[3]),
        .out_resp4    (bus.resp[4]), .out_data4   (bus.dout[4])
    );

    calc1_env   env;
    calc1_tests tests;

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
        $display(" Calc1 verification  test=%s  BUG=%0d", test, BUG);
        $display("==============================================================");

        env.apply_reset(8);
        env.run_bfm();

        if (test == "smoke"    || test == "regress") tests.smoke();
        if (test == "directed" || test == "regress") tests.directed();
        if (test == "priority" || test == "regress") tests.priority_contention();
        if (test == "random"   || test == "regress") tests.random_traffic();

        cov_pct = env.cov.report(cov_json);
        $display("--------------------------------------------------------------");
        $display(" checked=%0d pass=%0d fail=%0d spurious=%0d  coverage=%0.1f%%",
                 env.sb.n_checked, env.sb.n_pass, env.sb.n_fail, env.spurious, cov_pct);
        $display(" RESULT: %s", (env.sb.n_fail == 0 && env.spurious == 0) ? "PASS" : "FAIL");
        $display("@@SUMMARY {\"design\":\"calc1\",\"test\":\"%s\",\"bug\":%0d,\"checked\":%0d,\"pass\":%0d,\"fail\":%0d,\"spurious\":%0d,\"coverage\":%0.2f,\"cov\":{%s},\"fail_kinds\":%s,\"fail_cmds\":%s,\"first_fail\":\"%s\"}",
                 test, BUG, env.sb.n_checked, env.sb.n_pass, env.sb.n_fail, env.spurious, cov_pct,
                 cov_json, env.sb.kinds_json(), env.sb.cmds_json(), env.sb.first_fail);
        $finish;
    end

    // global watchdog
    initial begin
        #50ms;
        $display("[FATAL] global watchdog expired");
        $finish;
    end
endmodule
