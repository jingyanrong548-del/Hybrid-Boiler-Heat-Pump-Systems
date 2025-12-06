// src/chartHelper.js
import Chart from 'chart.js/auto';
import { calculateHeatPumpCycle, SYSTEM_CONFIG } from './logic.js';

let chartInstance = null;

/**
 * 智能图表绘制：根据拓扑模式自动切换 X 轴维度
 * @param {string} topology 'PARALLEL' | 'COUPLED'
 * @param {number} tInput  当前输入温度 (环境或余热)
 * @param {number} tSupply 当前目标供水温度
 * @param {object} Module  WASM 模块
 */
export function updateChart(topology, tInput, tSupply, Module) {
    const ctx = document.getElementById('performance-chart');
    if (!ctx) return;

    // 销毁旧图表
    if (chartInstance) {
        chartInstance.destroy();
    }

    let labels = [];
    let dataCOP = [];
    let xLabel = "";
    let chartTitle = "";
    
    // --- 模式分支 ---
    
    if (topology === 'PARALLEL') {
        // [模式 A] 传统环境源：X轴 = 环境温度 (-20 ~ 20)
        xLabel = "室外环境温度 (°C)";
        chartTitle = `COP 趋势 (固定供水 ${tSupply}°C)`;
        
        for (let t = -20; t <= 20; t += 2) {
            labels.push(t);
            // 计算：热源变，供水不变
            const res = calculateHeatPumpCycle(t, tSupply, Module);
            dataCOP.push(res.error ? null : res.cop);
        }

    } else {
        // [模式 B] 余热耦合：X轴 = 目标供水温度 (45 ~ 85)
        // 因为热源是恒定的 (35度)，分析随供水温度升高的性能衰减更有意义
        xLabel = "目标供水温度 (°C)";
        chartTitle = `COP 趋势 (固定热源 ${SYSTEM_CONFIG.wasteHeatTemp}°C)`;
        
        for (let t = 45; t <= 85; t += 5) {
            labels.push(t);
            // 计算：热源不变(35)，供水变(t)
            const res = calculateHeatPumpCycle(SYSTEM_CONFIG.wasteHeatTemp, t, Module);
            dataCOP.push(res.error ? null : res.cop);
        }
    }

    // --- 绘制图表 ---
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '系统 COP',
                data: dataCOP,
                borderColor: topology === 'COUPLED' ? 'rgb(147, 51, 234)' : 'rgb(59, 130, 246)', // 紫色 vs 蓝色
                backgroundColor: topology === 'COUPLED' ? 'rgba(147, 51, 234, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                borderWidth: 3,
                tension: 0.3,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: chartTitle,
                    font: { size: 16, weight: 'bold' },
                    color: '#334155'
                },
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `COP: ${ctx.raw}`
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: xLabel, color: '#64748b' },
                    grid: { color: '#f1f5f9' }
                },
                y: {
                    title: { display: true, text: '性能系数 (COP)', color: '#64748b' },
                    grid: { color: '#f1f5f9' },
                    min: 1.0
                }
            }
        }
    });
}