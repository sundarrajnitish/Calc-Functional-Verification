// =============================================================================
//  calc3_pkg.sv -- Layered, self-checking verification environment for Calc3
//  Author: Nitish Sundarraj
//
//   generator --mailbox[p]--> driver[p] --calc3_if--> DUT
//                                             |         |
//                               input monitor |         | output monitor
//                                             v         v
//                         predictor (ref model)  --> scoreboard keyed by
//                         runs on what the DUT       (port, tag), so out-of-
//                         actually sampled           order responses are OK
//
//  Key fixes versus the 2024 environment (see README):
//    * the predictor is driven by an INPUT MONITOR, i.e. by what the DUT really
//      saw, cycle by cycle, in port order 1..4 -- not by the sequencer's intent
//    * expected results are stored per (port, tag) and matched per (port, tag)
//      (the old scoreboard indexed arrays with port-1 / i-1, re-executed stale
//      commands of all four ports on every check, and compared every port on
//      every response)
//    * free-tag pool per port: up to four commands in flight, never reusing a
//      tag that is still outstanding
//    * lost/duplicate/unknown-tag responses and timeouts are all detected
//    * scan clocks a_clk/b_clk are held low (the old test drove them with the
//      functional clock)
// =============================================================================
`timescale 1ns/1ps

package calc3_pkg;

    localparam bit [3:0] C_NOP = 0, C_ADD = 1, C_SUB = 2, C_SHL = 5, C_SHR = 6,
                         C_STORE = 9, C_FETCH = 10, C_BZ = 12, C_BE = 13;
    localparam bit [1:0] R_NONE = 0, R_OK = 1, R_ERR = 2, R_SKIP = 3;
    localparam int       TIMEOUT_CYCLES = 40;

    function automatic string cmd_name(bit [3:0] c);
        case (c)
            C_ADD: return "ADD";     C_SUB: return "SUB";     C_SHL: return "SHL";
            C_SHR: return "SHR";     C_STORE: return "STORE"; C_FETCH: return "FETCH";
            C_BZ: return "BZ";       C_BE: return "BE";       C_NOP: return "NOP";
            default: return $sformatf("INV%0d", c);
        endcase
    endfunction

    function automatic bit is_valid(bit [3:0] c);
        return c inside {C_ADD, C_SUB, C_SHL, C_SHR, C_STORE, C_FETCH, C_BZ, C_BE};
    endfunction

    // =====================================================================
    //  Transaction
    // =====================================================================
    class calc3_txn;
        static int unsigned next_id = 0;
        int unsigned id;
        rand bit [2:0]  port;
        rand bit [3:0]  cmd, d1, d2, r1;
        rand bit [31:0] data;
        rand int unsigned gap;
        bit [1:0]  tag;                  // assigned by the driver (free-tag pool)
        rand bit [3:0] reg_window;       // helper: restrict registers -> hazards

        constraint c_port { port inside {[1:4]}; }
        constraint c_cmd  { cmd dist { C_ADD := 14, C_SUB := 14, C_SHL := 9, C_SHR := 9,
                                       C_STORE := 22, C_FETCH := 18, C_BZ := 6, C_BE := 6,
                                       [4'd3:4'd4] :/ 1, [4'd7:4'd8] :/ 1, 4'd11 := 0,
                                       [4'd14:4'd15] :/ 1 }; }
        // most traffic uses registers 0..reg_window to create read-after-write hazards
        constraint c_win  { reg_window dist { 4'd3 := 50, 4'd7 := 30, 4'd15 := 20 }; }
        constraint c_regs { d1 <= reg_window; d2 <= reg_window; r1 <= reg_window; }
        constraint c_data { data dist { 32'd0 := 15, 32'hFFFF_FFFF := 5, [32'd1:32'd31] :/ 30,
                                        32'h8000_0000 := 5, [32'd32:32'hFFFF_FFFE] :/ 45 }; }
        constraint c_gap  { gap dist { 0 := 50, [1:3] :/ 50 }; }

        function new(); id = next_id++; endfunction

        function string sprint();
            return $sformatf("#%0d P%0d T%0d %s d1=R%0d d2=R%0d r1=R%0d data=0x%08h",
                             id, port, tag, cmd_name(cmd), d1, d2, r1, data);
        endfunction
    endclass

    // =====================================================================
    //  Reference model (executable spec). Called once per accepted command,
    //  in acceptance order (cycle, then port 1..4).
    // =====================================================================
    class calc3_ref_model;
        bit [31:0] rf [16];
        bit        skip [1:4];
        // bookkeeping for coverage
        bit        last_skipped;
        bit        last_branch_taken;

        function void reset();
            foreach (rf[i]) rf[i] = 0;
            for (int p = 1; p <= 4; p++) skip[p] = 0;
        endfunction

        function void execute(int p, bit [3:0] cmd, bit [3:0] d1, bit [3:0] d2, bit [3:0] r1,
                              bit [31:0] data, output bit [1:0] resp, output bit [31:0] odata);
            bit [31:0] a = rf[d1], b = rf[d2];
            bit [32:0] wide;
            odata = 0; resp = R_OK;
            last_skipped = 0; last_branch_taken = 0;
            if (skip[p]) begin                       // command after a taken branch
                skip[p] = 0; resp = R_SKIP; last_skipped = 1;
                return;
            end
            case (cmd)
                C_ADD:   begin wide = {1'b0, a} + {1'b0, b};
                               if (wide[32]) resp = R_ERR; else rf[r1] = wide[31:0]; end
                C_SUB:   begin if (b > a) resp = R_ERR; else rf[r1] = a - b; end
                C_SHL:   rf[r1] = a << b[4:0];
                C_SHR:   rf[r1] = a >> b[4:0];
                C_STORE: rf[r1] = data;
                C_FETCH: odata = a;
                C_BZ:    begin skip[p] = (a == 0); last_branch_taken = skip[p]; end
                C_BE:    begin skip[p] = (a == b); last_branch_taken = skip[p]; end
                default: resp = R_ERR;
            endcase
        endfunction
    endclass

    // =====================================================================
    //  Coverage (portable counters; exported as JSON)
    // =====================================================================
    class calc3_coverage;
        int cmd_port   [16][5];
        int tag_port   [4][5];
        int reg_wr     [16];
        int reg_rd     [16];
        int br_taken   [2][2];     // [bz/be][taken]
        int skipped_cmd[16];
        int depth      [5][5];     // [port][outstanding when issued 1..4]
        int ooo_port   [5];        // response overtook an older command
        int xport_raw;             // same-cycle cross-port write->read of a register
        int b2b_raw;               // consecutive-cycle write->read, same port
        int ovf_port   [5], unf_port[5];
        int inv_seen;
        int fetch_nonzero;

        function void group(string name, int hit, int total, ref string json, ref int h, ref int n);
            json = {json, $sformatf("%s\"%s\":[%0d,%0d]", (json.len() ? "," : ""), name, hit, total)};
            h += hit; n += total;
        endfunction

        function real report(output string json);
            int h = 0, n = 0, hit;
            bit [3:0] vc[8] = '{C_ADD, C_SUB, C_SHL, C_SHR, C_STORE, C_FETCH, C_BZ, C_BE};
            json = "";
            hit = 0; foreach (vc[i]) for (int p = 1; p <= 4; p++) hit += (cmd_port[vc[i]][p] > 0);
            group("cmd_x_port", hit, 32, json, h, n);
            hit = 0; for (int t = 0; t < 4; t++) for (int p = 1; p <= 4; p++) hit += (tag_port[t][p] > 0);
            group("tag_x_port", hit, 16, json, h, n);
            hit = 0; for (int r = 0; r < 16; r++) hit += (reg_wr[r] > 0) + (reg_rd[r] > 0);
            group("registers_rd_wr", hit, 32, json, h, n);
            hit = (br_taken[0][0] > 0) + (br_taken[0][1] > 0) + (br_taken[1][0] > 0) + (br_taken[1][1] > 0);
            group("branch_taken_not", hit, 4, json, h, n);
            hit = 0; foreach (vc[i]) hit += (skipped_cmd[vc[i]] > 0);
            group("skipped_cmd_kind", hit, 8, json, h, n);
            hit = 0; for (int p = 1; p <= 4; p++) for (int d = 1; d <= 4; d++) hit += (depth[p][d] > 0);
            group("outstanding_depth", hit, 16, json, h, n);
            hit = 0; for (int p = 1; p <= 4; p++) hit += (ooo_port[p] > 0);
            group("out_of_order_x_port", hit, 4, json, h, n);
            group("hazard_cross_port", xport_raw > 0, 1, json, h, n);
            group("hazard_back_to_back", b2b_raw > 0, 1, json, h, n);
            hit = 0; for (int p = 1; p <= 4; p++) hit += (ovf_port[p] > 0) + (unf_port[p] > 0);
            group("ovf_unf_x_port", hit, 8, json, h, n);
            group("invalid_cmd", inv_seen > 0, 1, json, h, n);
            return (n == 0) ? 0.0 : 100.0 * h / n;
        endfunction
    endclass

    // =====================================================================
    //  Expected-result record held by the scoreboard
    // =====================================================================
    class calc3_exp;
        calc3_txn  t;
        bit [1:0]  resp;
        bit [31:0] data;
        longint    t_accept;
    endclass

    // =====================================================================
    //  Environment
    // =====================================================================
    class calc3_env;
        virtual calc3_if     vif;
        calc3_ref_model      ref_m;
        calc3_coverage       cov;
        mailbox #(calc3_txn) gen2drv [1:4];
        bit [1:0]            free_tags [1:4][$];
        calc3_txn            by_tag    [1:4][4];   // driver -> monitor hand-off
        calc3_exp            expect_q  [1:4][4];   // outstanding expectations
        int                  outstanding [1:4];
        longint              cycle;
        int                  pending;
        // scoreboard counters
        int n_checked, n_pass, n_fail, max_print = 25;
        int fail_by_kind[string];
        int fail_by_cmd [string];
        string first_fail;
        // hazard tracking for coverage
        int last_wr_reg [1:4];
        longint last_wr_cyc [1:4];

        function new(virtual calc3_if vif);
            this.vif = vif;
            ref_m = new(); cov = new();
            for (int p = 1; p <= 4; p++) begin
                gen2drv[p] = new();
                for (int t = 0; t < 4; t++) free_tags[p].push_back(t[1:0]);
                last_wr_reg[p] = -1;
            end
        endfunction

        task apply_reset(int cycles = 8);
            vif.drv_cb.reset <= 1'b1;
            vif.drv_cb.cmd <= '0; vif.drv_cb.d1 <= '0; vif.drv_cb.d2 <= '0;
            vif.drv_cb.r1 <= '0; vif.drv_cb.tag <= '0; vif.drv_cb.data <= '0;
            repeat (cycles) @(vif.drv_cb);
            vif.drv_cb.reset <= 1'b0;
            ref_m.reset();
            @(vif.drv_cb);
        endtask

        function calc3_txn make(int port, bit [3:0] cmd, bit [3:0] d1 = 0, bit [3:0] d2 = 0,
                                bit [3:0] r1 = 0, bit [31:0] data = 0, int gap = 0);
            calc3_txn t = new();
            t.port = port[2:0]; t.cmd = cmd; t.d1 = d1; t.d2 = d2; t.r1 = r1; t.data = data; t.gap = gap;
            return t;
        endfunction

        function void send(calc3_txn t);
            pending++;
            void'(gen2drv[t.port].try_put(t));
        endfunction

        task wait_idle();
            while (pending > 0) @(vif.mon_cb);
            repeat (2) @(vif.mon_cb);
        endtask

        // -------------------------------------------------------- driver
        task drive_port(int p);
            calc3_txn t;
            forever begin
                // Keep drives aligned to clock edges: if we had to block on the
                // mailbox we are between edges, so resynchronise first.
                if (!gen2drv[p].try_get(t)) begin
                    gen2drv[p].get(t);
                    @(vif.drv_cb);
                end
                repeat (t.gap) @(vif.drv_cb);
                while (free_tags[p].size() == 0) @(vif.drv_cb);
                t.tag = free_tags[p].pop_front();
                by_tag[p][t.tag] = t;
                vif.drv_cb.cmd[p]  <= t.cmd;  vif.drv_cb.d1[p]  <= t.d1;  vif.drv_cb.d2[p] <= t.d2;
                vif.drv_cb.r1[p]   <= t.r1;   vif.drv_cb.tag[p] <= t.tag; vif.drv_cb.data[p] <= t.data;
                @(vif.drv_cb);
                vif.drv_cb.cmd[p]  <= 4'd0;   vif.drv_cb.data[p] <= 32'd0;
            end
        endtask

        // -------------------------------------------------------- monitor
        task monitor();
            forever begin
                @(vif.mon_cb);
                cycle++;
                // 1) responses produced by earlier commands
                for (int p = 1; p <= 4; p++)
                    if (vif.mon_cb.out_resp[p] !== R_NONE)
                        observe_response(p, vif.mon_cb.out_resp[p], vif.mon_cb.out_tag[p], vif.mon_cb.out_data[p]);
                // 2) commands the DUT accepted at this edge -> predictor
                for (int p = 1; p <= 4; p++)
                    if (vif.mon_cb.cmd[p] != C_NOP) observe_command(p);
                // 3) lost responses
                for (int p = 1; p <= 4; p++)
                    for (int t = 0; t < 4; t++)
                        if (expect_q[p][t] != null && cycle - expect_q[p][t].t_accept > TIMEOUT_CYCLES) begin
                            fail("no_response", expect_q[p][t].t, $sformatf("no response after %0d cycles", TIMEOUT_CYCLES));
                            retire(p, t);
                        end
            end
        endtask

        function void observe_command(int p);
            bit [3:0]  c  = vif.mon_cb.cmd[p],  d1 = vif.mon_cb.d1[p], d2 = vif.mon_cb.d2[p], r1 = vif.mon_cb.r1[p];
            bit [1:0]  tg = vif.mon_cb.tag[p];
            bit [31:0] dt = vif.mon_cb.data[p];
            calc3_exp  e  = new();
            bit        writes;
            e.t = by_tag[p][tg];
            if (e.t == null) begin e.t = make(p, c, d1, d2, r1, dt); e.t.tag = tg; end
            if (expect_q[p][tg] != null) fail("tag_reused_by_tb", e.t, "testbench reused an outstanding tag");

            // coverage: hazards (read of a register written this cycle by a lower port / last cycle)
            for (int q = 1; q < p; q++)
                if (last_wr_cyc[q] == cycle && (last_wr_reg[q] == d1 || last_wr_reg[q] == d2)) cov.xport_raw++;
            if (last_wr_cyc[p] == cycle - 1 && (last_wr_reg[p] == d1 || last_wr_reg[p] == d2)) cov.b2b_raw++;

            ref_m.execute(p, c, d1, d2, r1, dt, e.resp, e.data);
            e.t_accept = cycle;
            expect_q[p][tg] = e;
            outstanding[p]++;

            cov.cmd_port[c][p]++;
            cov.tag_port[tg][p]++;
            cov.depth[p][outstanding[p]]++;
            if (!is_valid(c)) cov.inv_seen++;
            if (ref_m.last_skipped) cov.skipped_cmd[c]++;
            if (c == C_BZ && !ref_m.last_skipped) cov.br_taken[0][ref_m.last_branch_taken]++;
            if (c == C_BE && !ref_m.last_skipped) cov.br_taken[1][ref_m.last_branch_taken]++;
            if (c == C_ADD && e.resp == R_ERR) cov.ovf_port[p]++;
            if (c == C_SUB && e.resp == R_ERR) cov.unf_port[p]++;
            writes = !ref_m.last_skipped && e.resp == R_OK && (c inside {C_ADD, C_SUB, C_SHL, C_SHR, C_STORE});
            if (writes) begin cov.reg_wr[r1]++; last_wr_reg[p] = r1; last_wr_cyc[p] = cycle; end
            if (c inside {C_ADD, C_SUB, C_SHL, C_SHR, C_FETCH, C_BZ, C_BE}) cov.reg_rd[d1]++;
            if (c inside {C_ADD, C_SUB, C_SHL, C_SHR, C_BE}) cov.reg_rd[d2]++;
            if (c == C_FETCH && e.data != 0) cov.fetch_nonzero++;
        endfunction

        function void observe_response(int p, logic [1:0] r, logic [1:0] tg, logic [31:0] d);
            calc3_exp e;
            string kind = "";
            if ($isunknown(tg) || $isunknown(r)) begin
                fail("x_on_output", make(p, 0), $sformatf("resp=%b tag=%b", r, tg)); return;
            end
            e = expect_q[p][tg];
            if (e == null) begin
                calc3_txn dummy = make(p, 0); dummy.tag = tg;
                fail("unexpected_tag", dummy, $sformatf("resp=%0d for tag %0d that is not outstanding", r, tg));
                return;
            end
            // out-of-order coverage: an older command on this port is still waiting
            for (int t = 0; t < 4; t++)
                if (t != tg && expect_q[p][t] != null && expect_q[p][t].t_accept < e.t_accept) cov.ooo_port[p]++;

            if (r != e.resp) kind = "wrong_resp";
            else if (e.t.cmd == C_FETCH && e.resp == R_OK && d !== e.data) kind = "wrong_data";
            n_checked++;
            if (kind == "") n_pass++;
            else fail(kind, e.t, $sformatf("exp resp=%0d data=0x%08h | got resp=%0d data=0x%08h",
                                           e.resp, e.data, r, d), 1);
            retire(p, tg);
        endfunction

        function void retire(int p, int tg);
            expect_q[p][tg] = null;
            by_tag[p][tg]   = null;
            outstanding[p]--;
            free_tags[p].push_back(tg[1:0]);
            pending--;
        endfunction

        function void fail(string kind, calc3_txn t, string detail, bit counted = 0);
            string msg;
            if (!counted) n_checked++;
            n_fail++;
            fail_by_kind[kind]++;
            fail_by_cmd[cmd_name(t.cmd)]++;
            msg = $sformatf("[FAIL:%s] cycle %0d %s | %s", kind, cycle, t.sprint(), detail);
            if (first_fail == "") first_fail = msg;
            if (n_fail <= max_print) $display("%s", msg);
            else if (n_fail == max_print + 1) $display("[FAIL] ... further failures counted but not printed");
        endfunction

        function string map_json(ref int m[string]);
            string s = "";
            foreach (m[k]) s = {s, (s.len() ? "," : ""), $sformatf("\"%s\":%0d", k, m[k])};
            return {"{", s, "}"};
        endfunction

        task run_bfm();
            fork
                monitor();
                drive_port(1); drive_port(2); drive_port(3); drive_port(4);
            join_none
        endtask
    endclass

    // =====================================================================
    //  Tests
    // =====================================================================
    class calc3_tests;
        calc3_env env;
        int unsigned n_random = 3000;
        function new(calc3_env env); this.env = env; endfunction

        // store a distinct value in every register from every port, fetch back
        task smoke();
            $display("[TEST] smoke: store/fetch all registers from all ports, basic ALU ops");
            for (int p = 1; p <= 4; p++) begin
                for (int r = 0; r < 16; r++) env.send(env.make(p, C_STORE, 0, 0, r, 32'h1000 * p + r, 1));
                for (int r = 0; r < 16; r++) env.send(env.make(p, C_FETCH, r, 0, 0, 0, 1));
                env.wait_idle();
            end
            env.send(env.make(1, C_STORE, 0, 0, 1, 25, 1));
            env.send(env.make(1, C_STORE, 0, 0, 2, 5, 1));
            env.send(env.make(1, C_ADD, 1, 2, 3, 0, 1));   env.send(env.make(1, C_FETCH, 3, 0, 0, 0, 4));
            env.send(env.make(1, C_SUB, 1, 2, 4, 0, 1));   env.send(env.make(1, C_FETCH, 4, 0, 0, 0, 4));
            env.send(env.make(1, C_SHL, 1, 2, 5, 0, 1));   env.send(env.make(1, C_FETCH, 5, 0, 0, 0, 5));
            env.send(env.make(1, C_SHR, 1, 2, 6, 0, 1));   env.send(env.make(1, C_FETCH, 6, 0, 0, 0, 5));
            env.wait_idle();
        endtask

        task directed();
            $display("[TEST] directed: overflow, underflow, shifts, branches, skip side-effects, invalid");
            for (int p = 1; p <= 4; p++) begin
                // R0=0, R1=1, R2=max, R3=0x80000000, R4=33 (shift amount 1 via low 5 bits)
                env.send(env.make(p, C_STORE, 0, 0, 0, 0, 1));
                env.send(env.make(p, C_STORE, 0, 0, 1, 1, 1));
                env.send(env.make(p, C_STORE, 0, 0, 2, 32'hFFFF_FFFF, 1));
                env.send(env.make(p, C_STORE, 0, 0, 3, 32'h8000_0000, 1));
                env.send(env.make(p, C_STORE, 0, 0, 4, 33, 1));
                env.wait_idle();
                env.send(env.make(p, C_ADD, 2, 1, 5, 0, 1));    // overflow -> resp 2, R5 untouched
                env.send(env.make(p, C_ADD, 3, 3, 5, 0, 1));    // overflow
                env.send(env.make(p, C_SUB, 0, 1, 5, 0, 1));    // underflow
                env.send(env.make(p, C_FETCH, 5, 0, 0, 0, 4));
                env.send(env.make(p, C_SUB, 2, 2, 6, 0, 1));    // equal -> 0
                env.send(env.make(p, C_FETCH, 6, 0, 0, 0, 4));
                env.send(env.make(p, C_SHL, 1, 4, 7, 0, 1));    // 1 << (33 & 31) = 2
                env.send(env.make(p, C_FETCH, 7, 0, 0, 0, 5));
                env.send(env.make(p, C_SHR, 3, 4, 8, 0, 1));    // 0x80000000 >> 1
                env.send(env.make(p, C_FETCH, 8, 0, 0, 0, 5));
                env.wait_idle();
                // branch if zero: taken (R0==0) -> next store skipped, R9 keeps old value
                env.send(env.make(p, C_STORE, 0, 0, 9, 32'hAAAA, 1));
                env.send(env.make(p, C_BZ, 0, 0, 0, 0, 1));
                env.send(env.make(p, C_STORE, 0, 0, 9, 32'hBAD, 1));   // must be skipped
                env.send(env.make(p, C_FETCH, 9, 0, 0, 0, 1));          // expect 0xAAAA
                env.send(env.make(p, C_BZ, 1, 0, 0, 0, 1));             // not taken
                env.send(env.make(p, C_STORE, 0, 0, 9, 32'hC0DE, 1));   // executes
                env.send(env.make(p, C_FETCH, 9, 0, 0, 0, 1));
                // branch if equal: taken, and a skipped ADD must not write
                env.send(env.make(p, C_BE, 2, 2, 0, 0, 1));
                env.send(env.make(p, C_ADD, 1, 1, 9, 0, 1));            // skipped
                env.send(env.make(p, C_FETCH, 9, 0, 0, 0, 4));
                // BE with equal low halves but different high halves: not taken
                env.send(env.make(p, C_STORE, 0, 0, 10, 32'h0001_1234, 1));
                env.send(env.make(p, C_STORE, 0, 0, 11, 32'h0002_1234, 1));
                env.send(env.make(p, C_BE, 10, 11, 0, 0, 1));
                env.send(env.make(p, C_STORE, 0, 0, 12, 32'h600D, 1));  // must execute
                env.send(env.make(p, C_FETCH, 12, 0, 0, 0, 1));
                // branch followed by branch: second one is skipped
                env.send(env.make(p, C_BZ, 0, 0, 0, 0, 1));
                env.send(env.make(p, C_BZ, 0, 0, 0, 0, 1));             // skipped
                env.send(env.make(p, C_STORE, 0, 0, 13, 32'h1313, 1));  // executes
                env.send(env.make(p, C_FETCH, 13, 0, 0, 0, 1));
                // a taken branch skips whatever comes next -- try every command kind
                begin
                    bit [3:0] kinds[8] = '{C_ADD, C_SUB, C_SHL, C_SHR, C_STORE, C_FETCH, C_BZ, C_BE};
                    foreach (kinds[k]) begin
                        env.send(env.make(p, C_BZ, 0, 0, 0, 0, 1));          // R0 == 0 -> taken
                        env.send(env.make(p, kinds[k], 1, 1, 14, 32'h7777, 1));
                    end
                    env.send(env.make(p, C_FETCH, 14, 0, 0, 0, 1));          // R14 never written
                end
                // register 15 and invalid opcodes
                env.send(env.make(p, C_STORE, 0, 0, 15, 32'hF00D_0000 + p, 1));
                env.send(env.make(p, C_FETCH, 15, 0, 0, 0, 1));
                env.send(env.make(p, 4'd3, 1, 1, 1, 0, 1));
                env.send(env.make(p, 4'd7, 1, 1, 1, 0, 1));
                env.send(env.make(p, 4'd14, 1, 1, 1, 0, 1));
                env.wait_idle();
            end
        endtask

        // RAW hazards: same-cycle cross-port and back-to-back same-port;
        // out-of-order: long-latency shift followed by a short fetch.
        task hazards();
            $display("[TEST] hazards: cross-port same-cycle RAW, back-to-back RAW, out-of-order tags");
            for (int rep = 0; rep < 16; rep++) begin
                bit [3:0] r = rep[3:0];
                // port 1 stores, port 2..4 fetch the same register in the SAME cycle
                env.send(env.make(1, C_STORE, 0, 0, r, 32'h5A00 + rep, 0));
                env.send(env.make(2, C_FETCH, r, 0, 0, 0, 0));
                env.send(env.make(3, C_FETCH, r, 0, 0, 0, 0));
                env.send(env.make(4, C_FETCH, r, 0, 0, 0, 0));
                env.wait_idle();
                // same port, consecutive cycles: store then fetch
                env.send(env.make(3, C_STORE, 0, 0, r, 32'hC300 + rep, 0));
                env.send(env.make(3, C_FETCH, r, 0, 0, 0, 0));
                // out-of-order: shift (4 cycles) then fetch (1 cycle) back to back
                env.send(env.make(4, C_SHL, r, r, (r + 1) % 16, 0, 0));
                env.send(env.make(4, C_FETCH, r, 0, 0, 0, 0));
                env.send(env.make(4, C_ADD, r, r, (r + 2) % 16, 0, 0));
                env.send(env.make(4, C_FETCH, (r + 1) % 16, 0, 0, 0, 0));
                env.wait_idle();
            end
            // four commands in flight on every port at once (tags 0..3)
            for (int p = 1; p <= 4; p++)
                for (int k = 0; k < 4; k++) env.send(env.make(p, C_SHR, k, 1, 8 + k, 0, 0));
            env.wait_idle();
        endtask

        task random_traffic();
            $display("[TEST] random: %0d constrained-random transactions", n_random);
            for (int i = 0; i < n_random; i++) begin
                calc3_txn t = new();
                if (!t.randomize()) $fatal(1, "randomize() failed");
                env.send(t);
                if (env.pending > 48) begin
                    while (env.pending > 16) @(env.vif.mon_cb);
                end
            end
            env.wait_idle();
        endtask
    endclass

endpackage
