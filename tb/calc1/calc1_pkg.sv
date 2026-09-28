// =============================================================================
//  calc1_pkg.sv -- Layered, self-checking verification environment for Calc1
//  Author: Nitish Sundarraj
//
//      +-----------+   mailbox[p]   +----------+   calc1_if    +-------+
//      | generator | -------------> | driver p | ------------> |  DUT  |
//      +-----------+                +----------+               +-------+
//            |  (test sequences)         | issued txn              |
//            v                           v                         v
//      +-------------+  predict  +------------+   observed   +---------+
//      |  ref model  | --------> | scoreboard | <----------- | monitor |
//      +-------------+           +------------+              +---------+
//                                      |
//                                 +----------+
//                                 | coverage |
//                                 +----------+
//
//  What changed versus the 2024 testbench (see README "Testbench bugs"):
//    * one reusable driver/monitor instead of 4x copy-pasted port code
//    * response 2 (error) is a legal answer, not "no response"
//    * per-transaction timeout instead of a global clk_count that never resets
//    * expected values from an independent reference model, checked for EVERY
//      transaction, including X/Z detection on out_resp/out_data
//    * constrained-random stimulus with corner-case distributions
//    * functional coverage tied to the verification plan
// =============================================================================
`timescale 1ns/1ps

package calc1_pkg;

    // ------------------------------------------------------------ constants
    typedef enum bit [3:0] {
        NOP = 4'd0, ADD = 4'd1, SUB = 4'd2, SHL = 4'd5, SHR = 4'd6
    } cmd_e;

    localparam bit [1:0] RSP_NONE = 2'd0, RSP_OK = 2'd1, RSP_ERR = 2'd2, RSP_UNUSED = 2'd3;
    localparam int       TIMEOUT_CYCLES = 64;

    function automatic string cmd_name(bit [3:0] c);
        case (c)
            4'd0: return "NOP";  4'd1: return "ADD";  4'd2: return "SUB";
            4'd5: return "SHL";  4'd6: return "SHR";
            default: return $sformatf("INV%0d", c);
        endcase
    endfunction

    function automatic bit is_valid_cmd(bit [3:0] c);
        return c inside {4'd1, 4'd2, 4'd5, 4'd6};
    endfunction

    // =====================================================================
    //  Transaction
    // =====================================================================
    class calc1_txn;
        static int unsigned next_id = 0;
        int unsigned id;

        rand bit [2:0]  port;          // 1..4
        rand bit [3:0]  cmd;
        rand bit [31:0] op1;
        rand bit [31:0] op2;
        rand int unsigned gap;         // idle cycles before issue

        // expected (from the reference model) and observed results
        bit [1:0]  exp_resp;  bit [31:0] exp_data;
        logic [1:0] act_resp; logic [31:0] act_data;
        longint    t_issue, t_resp;
        bit        timed_out;

        constraint c_port { port inside {[1:4]}; }
        constraint c_cmd  { cmd dist { 4'd1 := 30, 4'd2 := 30, 4'd5 := 15, 4'd6 := 15,
                                       4'd0 := 0,  [4'd3:4'd4] :/ 3, [4'd7:4'd15] :/ 7 }; }
        constraint c_op1  { op1 dist { 32'd0 := 5, 32'hFFFF_FFFF := 5, [32'd1:32'd15] :/ 10,
                                       [32'd16:32'hFFFF_FFFE] :/ 80 }; }
        constraint c_op2  { op2 dist { 32'd0 := 5, 32'hFFFF_FFFF := 5, [32'd1:32'd31] :/ 30,
                                       [32'd32:32'hFFFF_FFFE] :/ 60 }; }
        constraint c_gap  { gap dist { 0 := 60, [1:4] :/ 40 }; }

        function new();
            id = next_id++;
        endfunction

        function string sprint();
            return $sformatf("#%0d P%0d %s op1=0x%08h op2=0x%08h", id, port, cmd_name(cmd), op1, op2);
        endfunction
    endclass

    // =====================================================================
    //  Reference model: an executable copy of the Calc1 specification.
    //  Transaction-level and timing-free on purpose -- it must not share any
    //  implementation detail with the DUT.
    // =====================================================================
    class calc1_ref_model;
        static function void predict(calc1_txn t);
            bit [32:0] wide;
            t.exp_data = 0;
            t.exp_resp = RSP_OK;
            case (t.cmd)
                4'd1: begin
                    wide = {1'b0, t.op1} + {1'b0, t.op2};
                    if (wide[32]) t.exp_resp = RSP_ERR; else t.exp_data = wide[31:0];
                end
                4'd2: begin
                    if (t.op2 > t.op1) t.exp_resp = RSP_ERR; else t.exp_data = t.op1 - t.op2;
                end
                4'd5: t.exp_data = t.op1 << t.op2[4:0];
                4'd6: t.exp_data = t.op1 >> t.op2[4:0];
                default: t.exp_resp = RSP_ERR;      // invalid command
            endcase
        endfunction
    endclass

    // =====================================================================
    //  Functional coverage (portable: plain counters, exported as JSON).
    //  Mirrors the verification plan in docs/ ; every bin is a plan item.
    // =====================================================================
    class calc1_coverage;
        int cmd_port   [16][5];   // [cmd][port]          valid cmds x ports
        int resp_cmd   [4][16];   // [resp][cmd]
        int op_class1  [5];       // zero, one, all-ones, small(<32), large
        int op_class2  [5];
        int shl_amt    [32];
        int shr_amt    [32];
        int ovf_port   [5];       // add carry-out seen per port
        int unf_port   [5];       // sub borrow seen per port
        int sub_equal;            // op1 == op2 -> result 0
        int inv_cmd    [16];      // each invalid opcode
        int concurrency[5];       // #ports busy when a command is issued
        int walk_op2   [32];      // single-bit op2 patterns for ADD (bit i)
        int timeouts;

        static function int op_class(bit [31:0] v);
            if (v == 0)              return 0;
            if (v == 1)              return 1;
            if (v == 32'hFFFF_FFFF)  return 2;
            if (v < 32)              return 3;
            return 4;
        endfunction

        function void sample_issue(calc1_txn t, int busy_ports);
            cmd_port[t.cmd][t.port]++;
            op_class1[op_class(t.op1)]++;
            op_class2[op_class(t.op2)]++;
            if (t.cmd == 4'd5) shl_amt[t.op2[4:0]]++;
            if (t.cmd == 4'd6) shr_amt[t.op2[4:0]]++;
            if (!is_valid_cmd(t.cmd) && t.cmd != 0) inv_cmd[t.cmd]++;
            if (t.cmd == 4'd1 && $countones(t.op2) == 1)
                for (int i = 0; i < 32; i++) if (t.op2[i]) walk_op2[i]++;
            if (t.cmd == 4'd2 && t.op1 == t.op2) sub_equal++;
            concurrency[busy_ports]++;
        endfunction

        function void sample_result(calc1_txn t);
            if (t.timed_out) begin timeouts++; return; end
            if (!$isunknown(t.act_resp)) resp_cmd[t.act_resp][t.cmd]++;
            if (t.cmd == 4'd1 && t.exp_resp == RSP_ERR) ovf_port[t.port]++;
            if (t.cmd == 4'd2 && t.exp_resp == RSP_ERR) unf_port[t.port]++;
        endfunction

        // ---- coverage figures ------------------------------------------
        function void group(string name, int hit, int total, ref string json, ref int h, ref int n);
            json = {json, $sformatf("%s\"%s\":[%0d,%0d]", (json.len() ? "," : ""), name, hit, total)};
            h += hit; n += total;
        endfunction

        function real report(output string json);
            int h = 0, n = 0, hit;
            bit [3:0] vc[4] = '{4'd1, 4'd2, 4'd5, 4'd6};
            json = "";
            hit = 0; foreach (vc[i]) for (int p = 1; p <= 4; p++) hit += (cmd_port[vc[i]][p] > 0);
            group("cmd_x_port", hit, 16, json, h, n);
            hit = 0; for (int c = 0; c < 16; c++) if (!is_valid_cmd(c) && c != 0) hit += (inv_cmd[c] > 0);
            group("invalid_opcodes", hit, 11, json, h, n);
            hit = 0; for (int i = 0; i < 5; i++) hit += (op_class1[i] > 0) + (op_class2[i] > 0);
            group("operand_classes", hit, 10, json, h, n);
            hit = 0; for (int i = 0; i < 32; i++) hit += (shl_amt[i] > 0) + (shr_amt[i] > 0);
            group("shift_amounts", hit, 64, json, h, n);
            hit = 0; for (int p = 1; p <= 4; p++) hit += (ovf_port[p] > 0) + (unf_port[p] > 0);
            group("ovf_unf_x_port", hit, 8, json, h, n);
            group("sub_equal", sub_equal > 0, 1, json, h, n);
            hit = 0; for (int i = 0; i < 32; i++) hit += (walk_op2[i] > 0);
            group("add_walking_one_op2", hit, 32, json, h, n);
            hit = 0; for (int i = 1; i <= 4; i++) hit += (concurrency[i] > 0);
            group("concurrency_1to4", hit, 4, json, h, n);
            hit = 0; foreach (vc[i]) hit += (resp_cmd[1][vc[i]] > 0);
            hit += (resp_cmd[2][1] > 0) + (resp_cmd[2][2] > 0);
            group("responses", hit, 6, json, h, n);
            return (n == 0) ? 0.0 : 100.0 * h / n;
        endfunction
    endclass

    // =====================================================================
    //  Scoreboard
    // =====================================================================
    class calc1_scoreboard;
        int n_checked, n_pass, n_fail;
        int fail_by_kind[string];
        int fail_by_cmd [string];
        int max_print = 25;
        string first_fail;

        function void check(calc1_txn t);
            string kind = "";
            n_checked++;
            if (t.timed_out)                                   kind = "no_response";
            else if ($isunknown(t.act_resp) || $isunknown(t.act_data)) kind = "x_on_output";
            else if (t.act_resp != t.exp_resp)                 kind = "wrong_resp";
            else if (t.exp_resp == RSP_OK && t.act_data != t.exp_data) kind = "wrong_data";

            if (kind == "") begin
                n_pass++;
            end else begin
                string msg;
                n_fail++;
                fail_by_kind[kind]++;
                fail_by_cmd[cmd_name(t.cmd)]++;
                msg = $sformatf("[FAIL:%s] %s | exp resp=%0d data=0x%08h | got resp=%b data=0x%08h (lat %0d)",
                                kind, t.sprint(), t.exp_resp, t.exp_data, t.act_resp, t.act_data,
                                t.t_resp - t.t_issue);
                if (first_fail == "") first_fail = msg;
                if (n_fail <= max_print) $display("%s", msg);
                else if (n_fail == max_print + 1) $display("[FAIL] ... further failures counted but not printed");
            end
        endfunction

        function string kinds_json();
            string s = "";
            foreach (fail_by_kind[k]) s = {s, (s.len() ? "," : ""), $sformatf("\"%s\":%0d", k, fail_by_kind[k])};
            return {"{", s, "}"};
        endfunction
        function string cmds_json();
            string s = "";
            foreach (fail_by_cmd[k]) s = {s, (s.len() ? "," : ""), $sformatf("\"%s\":%0d", k, fail_by_cmd[k])};
            return {"{", s, "}"};
        endfunction
    endclass

    // =====================================================================
    //  Environment: drivers + monitor + scoreboard + coverage for 4 ports
    // =====================================================================
    class calc1_env;
        virtual calc1_if   vif;
        calc1_scoreboard   sb;
        calc1_coverage     cov;
        mailbox #(calc1_txn) gen2drv [1:4];
        calc1_txn          inflight [1:4];
        bit                port_dead[1:4];
        int                busy;               // ports with a command in flight
        longint            cycle;
        int                spurious;           // responses with nothing in flight
        int                pending;            // txns queued but not finished

        function new(virtual calc1_if vif);
            this.vif = vif;
            sb  = new();
            cov = new();
            for (int p = 1; p <= 4; p++) gen2drv[p] = new();
        endfunction

        // ---- reset: reset[1:7] = all ones for 7+ cycles (test plan TC7)
        task apply_reset(int cycles = 8);
            vif.drv_cb.reset <= 7'b111_1111;
            vif.drv_cb.cmd   <= '0;
            vif.drv_cb.din   <= '0;
            repeat (cycles) @(vif.drv_cb);
            vif.drv_cb.reset <= 7'b000_0000;
            @(vif.drv_cb);
        endtask

        // ---- stimulus API used by the tests
        function void send(calc1_txn t);
            calc1_ref_model::predict(t);
            pending++;
            void'(gen2drv[t.port].try_put(t));
        endfunction

        function calc1_txn make(int port, bit [3:0] cmd, bit [31:0] op1, bit [31:0] op2, int gap = 0);
            calc1_txn t = new();
            t.port = port[2:0]; t.cmd = cmd; t.op1 = op1; t.op2 = op2; t.gap = gap;
            return t;
        endfunction

        task wait_idle();
            while (pending > 0) @(vif.mon_cb);
            repeat (2) @(vif.mon_cb);
        endtask

        // ---- driver: one outstanding command per port
        task drive_port(int p);
            calc1_txn t;
            forever begin
                gen2drv[p].get(t);
                if (port_dead[p]) begin                 // hung port: account & skip
                    t.timed_out = 1; sb.check(t); pending--; continue;
                end
                // Synchronous drives only take effect at the NEXT clocking event,
                // so always start from a clock edge; otherwise the op1 drive and
                // the op2 drive land on the same edge and op1 is lost.
                @(vif.drv_cb);
                repeat (t.gap) @(vif.drv_cb);
                cov.sample_issue(t, busy + 1);
                busy++;
                inflight[p]  = t;
                t.t_issue    = cycle;
                vif.drv_cb.cmd[p] <= t.cmd;             // cycle 1: command + operand 1
                vif.drv_cb.din[p] <= t.op1;
                @(vif.drv_cb);
                vif.drv_cb.cmd[p] <= 4'd0;              // cycle 2: operand 2
                vif.drv_cb.din[p] <= t.op2;
                @(vif.drv_cb);
                vif.drv_cb.din[p] <= 32'd0;
                wait (inflight[p] == null);             // released by the monitor
                busy--;
            end
        endtask

        // ---- monitor: sample every edge, match responses, detect hangs
        task monitor();
            forever begin
                @(vif.mon_cb);
                cycle++;
                for (int p = 1; p <= 4; p++) begin
                    logic [1:0]  r = vif.mon_cb.resp[p];
                    logic [31:0] d = vif.mon_cb.dout[p];
                    if (r !== RSP_NONE) begin
                        if (inflight[p] == null) begin
                            spurious++;
                            $display("[FAIL:spurious] cycle %0d port %0d resp=%b data=0x%08h with nothing in flight", cycle, p, r, d);
                        end else begin
                            finish_txn(p, r, d, 0);
                        end
                    end else if (inflight[p] != null && cycle - inflight[p].t_issue > TIMEOUT_CYCLES) begin
                        port_dead[p] = 1;
                        $display("[HANG] port %0d stopped responding -- no further commands sent to it", p);
                        finish_txn(p, 'x, 'x, 1);
                    end
                end
            end
        endtask

        function void finish_txn(int p, logic [1:0] r, logic [31:0] d, bit to);
            calc1_txn t = inflight[p];
            t.act_resp = r; t.act_data = d; t.t_resp = cycle; t.timed_out = to;
            sb.check(t);
            cov.sample_result(t);
            inflight[p] = null;
            pending--;
        endfunction

        task run_bfm();
            fork
                monitor();
                drive_port(1); drive_port(2); drive_port(3); drive_port(4);
            join_none
        endtask
    endclass

    // =====================================================================
    //  Tests  (each maps to rows of the verification plan)
    // =====================================================================
    class calc1_tests;
        calc1_env env;
        int unsigned n_random = 2000;

        function new(calc1_env env); this.env = env; endfunction

        // TC1-TC4 from the 2024 test plan, on every port
        task smoke();
            $display("[TEST] smoke: test-plan TC1..TC4 on all ports");
            for (int p = 1; p <= 4; p++) begin
                env.send(env.make(p, 4'd1, 5, 3));      // 8
                env.send(env.make(p, 4'd2, 10, 3));     // 7
                env.send(env.make(p, 4'd5, 8, 2));      // 32
                env.send(env.make(p, 4'd6, 16, 2));     // 4
            end
            env.wait_idle();
        endtask

        // Corner cases: carries, borrows, every shift amount, invalid opcodes,
        // walking ones through operand 2 (this is what exposes bridged bits).
        task directed();
            $display("[TEST] directed: boundaries, shifts 0..31, invalid opcodes, walking ones");
            for (int p = 1; p <= 4; p++) begin
                env.send(env.make(p, 4'd1, 32'hFFFF_FFFF, 32'd1));       // overflow
                env.send(env.make(p, 4'd1, 32'h8000_0000, 32'h8000_0000));
                env.send(env.make(p, 4'd1, 32'hFFFF_FFFE, 32'd1));       // max, no overflow
                env.send(env.make(p, 4'd1, 32'd0, 32'd0));
                env.send(env.make(p, 4'd2, 32'd0, 32'd1));               // underflow
                env.send(env.make(p, 4'd2, 32'd1234, 32'd1234));         // equal -> 0
                env.send(env.make(p, 4'd2, 32'hFFFF_FFFF, 32'd0));
                env.send(env.make(p, 4'd2, 32'd9, 32'd4));
                for (int s = 0; s < 32; s++) begin
                    env.send(env.make(p, 4'd5, 32'hA5A5_0F0F, s));
                    env.send(env.make(p, 4'd6, 32'hF0F0_5A5A, s));
                end
                env.send(env.make(p, 4'd5, 32'd1, 32'hFFFF_FFE3));       // only low 5 bits count (3)
                for (int c = 3; c < 16; c++) if (c != 5 && c != 6) env.send(env.make(p, c[3:0], 32'd7, 32'd2));
                for (int b = 0; b < 32; b++) env.send(env.make(p, 4'd1, 32'h0000_0100, 32'd1 << b));
            end
            env.wait_idle();
        endtask

        // All four ports hit the same unit in the same cycle (priority logic)
        task priority_contention();
            $display("[TEST] priority: simultaneous requests to the same unit");
            for (int rep = 0; rep < 20; rep++) begin
                bit [3:0] c = (rep % 2) ? 4'd1 : 4'd5;
                for (int p = 1; p <= 4; p++) env.send(env.make(p, c, 32'd100 * p + rep, 32'd3));
                env.wait_idle();
            end
            for (int rep = 0; rep < 20; rep++) begin          // mixed units
                env.send(env.make(1, 4'd1, rep, 7));  env.send(env.make(2, 4'd6, 32'hFF00 + rep, 4));
                env.send(env.make(3, 4'd2, 50 + rep, 9)); env.send(env.make(4, 4'd5, rep + 1, 5));
                env.wait_idle();
            end
        endtask

        // Constrained random traffic on all ports concurrently
        task random_traffic();
            $display("[TEST] random: %0d constrained-random transactions", n_random);
            for (int i = 0; i < n_random; i++) begin
                calc1_txn t = new();
                if (!t.randomize()) $fatal(1, "randomize() failed");
                env.send(t);
                if (env.pending > 48)                          // bound the queue depth
                    while (env.pending > 16) @(env.vif.mon_cb);
            end
            env.wait_idle();
        endtask
    endclass

endpackage
