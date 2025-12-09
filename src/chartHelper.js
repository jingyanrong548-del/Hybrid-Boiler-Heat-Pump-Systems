// src/chartHelper.js - v6.2 Advanced Chart Engine

import Chart from 'chart.js/auto';
import { calculateProcessCycle } from './logic.js';

let chartInstance = null;

/**
 * 绘制 COP 性能曲线
 * v6.2 Upgrade: 接收 perfectionDegree，确保曲线与用户设定一致
 * * @param {string} topology 'PARALLEL' | 'COUPLED'
 * @param {string} targetMode 'WATER' | 'STEAM'
 * @param {number} tSource 热源温度
 * @param {number} tCurrentTarget 当前目标值 (仅用于标记或标题)
 * @param {number} perfectionDegree 热力完善度 (0~1)
 */
export function updateChart(topology, targetMode, tSource, tCurrentTarget, perfectionDegree) {
    const ctx = document.getElementById('performance-chart');
    if (!ctx) return;

    // 销毁旧图表实例
    if (chartInstance) {
        chartInstance.destroy();
    }

    let labels = [];
    let dataCOP = [];
    let xLabel = "";
    let chartTitle = "";
    
    // 如果没有传入完善度，使用默认显示值 (防止 crash)
    const etaDisplay = perfectionDegree ? perfectionDegree.toFixed(2) : "Auto";

    // --- 场景分支逻辑 ---
    
    // 场景 1: 蒸汽模式 (X轴 = 压力)
    if (targetMode === 'STEAM') {
        xLabel = "饱和蒸汽压力 (MPa,a)";
        chartTitle = `蒸汽工况 COP 趋势 (热源 ${tSource}°C, η=${etaDisplay})`;
        
        // 扫描范围: 0.1 MPa ~ 1.2 MPa (覆盖常见工业低压蒸汽)
        for (let p = 0.1; p <= 1.2; p += 0.1) {
            let val = parseFloat(p.toFixed(1));
            labels.push(val);
            
            const res = calculateProcessCycle({ 
                mode: 'STEAM', 
                sourceTemp: tSource, 
                targetVal: val,
                perfectionDegree: perfectionDegree // 关键：传入用户设定的完善度
            });
            dataCOP.push(res.error ? null : res.cop);
        }

    } 
    // 场景 2: 热水 + 余热模式 (X轴 = 供水温度)
    else if (topology === 'COUPLED') {
        xLabel = "目标供水温度 (°C)";
        chartTitle = `余热提温 COP 趋势 (热源 ${tSource}°C, η=${etaDisplay})`;
        
        // 扫描范围: 45°C ~ 95°C
        for (let t = 45; t <= 95; t += 5) {
            labels.push(t);
            const res = calculateProcessCycle({ 
                mode: 'WATER', 
                sourceTemp: tSource, 
                targetVal: t,
                perfectionDegree: perfectionDegree 
            });
            dataCOP.push(res.error ? null : res.cop);
        }

    } 
    // 场景 3: 热水 + 环境源模式 (X轴 = 环境温度)
    else {
        xLabel = "室外环境温度 (°C)";
        chartTitle = `环境温变 COP 趋势 (供水 ${tCurrentTarget}°C, η=${etaDisplay})`;
        
        // 扫描范围: -25°C ~ 25°C
        for (let t = -25; t <= 25; t += 5) {
            labels.push(t);
            const res = calculateProcessCycle({ 
                mode: 'WATER', 
                sourceTemp: t, 
                targetVal: tCurrentTarget,
                perfectionDegree: perfectionDegree
            });
            dataCOP.push(res.error ? null : res.cop);
        }
    }

    // --- 绘图配置 ---
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `COP (η=${etaDisplay})`,
                data: dataCOP,
                // 根据模式自动切换颜色风格
                borderColor: targetMode === 'STEAM' ? 'rgb(236, 72, 153)' : 'rgb(79, 70, 229)', // 粉色(蒸汽) vs 紫色(热水)
                backgroundColor: targetMode === 'STEAM' ? 'rgba(236, 72, 153, 0.1)' : 'rgba(79, 70, 229, 0.1)',
                borderWidth: 3,
                tension: 0.4, // 曲线更平滑
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                title: {
                    display: true,
                    text: chartTitle,
                    font: { size: 14, weight: 'bold' },
                    color: '#475569'
                },
                legend: { display: false }, // 保持简洁，隐藏图例
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    padding: 10,
                    cornerRadius: 8,
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
                    grid: { borderDash: [2, 2], color: '#e2e8f0' },
                    min: 1.0 // COP 物理底线
                }
            }
        }
    });
}