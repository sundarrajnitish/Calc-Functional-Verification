// =============================================================================
//  calc1_if.sv -- Calc1 bus interface with race-free clocking blocks
//  Author: Nitish Sundarraj
//
//  The 2024 testbenches drove stimulus with blocking assignments right after
//  @(posedge c_clk) and sampled results on @(negedge c_clk). That races with
//  the DUT's own posedge sampling and is the root cause of several "off by one
//  transaction" mismatches in the old logs. All driving/sampling now goes
//  through clocking blocks: inputs are sampled #1step before the edge,
//  outputs are driven 1 ns after it.
// =============================================================================
`timescale 1ns/1ps

interface calc1_if (input logic c_clk);
    logic [1:7]        reset;
    logic [1:4][0:3]   cmd;      // reqN_cmd_in
    logic [1:4][0:31]  din;      // reqN_data_in
    logic [1:4][0:1]   resp;     // out_respN
    logic [1:4][0:31]  dout;     // out_dataN

    clocking drv_cb @(posedge c_clk);
        default input #1step output #1;
        output reset, cmd, din;
        input  resp, dout;
    endclocking

    clocking mon_cb @(posedge c_clk);
        default input #1step;
        input reset, cmd, din, resp, dout;
    endclocking

    modport tb  (clocking drv_cb, clocking mon_cb);
endinterface
