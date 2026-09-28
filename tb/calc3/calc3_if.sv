// =============================================================================
//  calc3_if.sv -- Calc3 bus interface with clocking blocks
//  Author: Nitish Sundarraj
// =============================================================================
`timescale 1ns/1ps

interface calc3_if (input logic c_clk);
    logic              reset;
    logic [1:4][0:3]   cmd, d1, d2, r1;
    logic [1:4][0:1]   tag;
    logic [1:4][0:31]  data;
    logic [1:4][0:1]   out_resp, out_tag;
    logic [1:4][0:31]  out_data;

    clocking drv_cb @(posedge c_clk);
        default input #1step output #1;
        output reset, cmd, d1, d2, r1, tag, data;
    endclocking

    clocking mon_cb @(posedge c_clk);
        default input #1step;
        input reset, cmd, d1, d2, r1, tag, data, out_resp, out_tag, out_data;
    endclocking
endinterface
