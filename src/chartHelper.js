// src/chartHelper.js - v7.9 Visualization Engine

import Chart from 'chart.js/auto';
import { calculateProcessCycle } from './logic.js';

let chartInstance = null;

export function updateChart(topology, targetMode, tSource, tCurrentTarget, perfectionDegree, recoveryType) {
    const ctx = document.getElementById('performance-chart');
    if (!ctx) return;

    if (chartInstance) chartInstance.destroy();

    let labels = [];
    let dataCOP = [];
    let xLabel = "";
    let chartTitle = "";
    
    // 🟢 确保完善度有默认值
    const eta = perfectionDegree || 0.45;
    const etaDisplay = eta.toFixed(2);

    // tCurrentTarget 在 main.js 中已经被转换为“真实温度”（即便是蒸汽模式，这里收到的也是饱和温度）
    // 这对于 Recovery 模式至关重要，因为 Recovery 模式的 X 轴是排烟温度，Y 轴计算依赖这个固定的 tCurrentTarget

    if (topology === 'RECOVERY') {
        xLabel = "初始排烟温度 (Exhaust In, °C)";
        
        const techName = recoveryType === 'ABSORPTION_HP' ? '吸收式 (Absorption)' : '电动式 (MVR)';
        const targetDesc = targetMode === 'STEAM' ? `蒸汽饱和温 ${tCurrentTarget}°C` : `供水 ${tCurrentTarget}°C`;
        
        chartTitle = `余热回收性能: ${techName} (${targetDesc}, η=${etaDisplay})`;

        for (let tIn = 60; tIn <= 180; tIn += 10) {
            labels.push(tIn);
            
            if (recoveryType === 'ABSORPTION_HP') {
                // 吸收式 COP 相对恒定，但如果是产蒸汽，效率略低
                const baseCop = (targetMode === 'STEAM') ? 1.45 : 1.70;
                dataCOP.push(baseCop); 
            } else {
                // 电动式计算
                const tOutFixed = 40; 
                const tEvap = tOutFixed + 8.0; // 锚定在 48°C (假设中间回路)
                const tCond = tCurrentTarget + 5;
                
                // 物理硬约束检查：蒸发必须低于冷凝
                if (tEvap >= tCond - 2) { 
                    dataCOP.push(null);
                } else {
                    const tk_evap = tEvap + 273.15;
                    const tk_cond = tCond + 273.15;
                    let cop_carnot = tk_cond / (tk_cond - tk_evap);
                    
                    // 限制保持 15 (防止低温差数值爆炸)
                    if (cop_carnot > 15) cop_carnot = 15;
                    
                    // 高温升惩罚 (如果是蒸汽模式，温升通常很大)
                    let liftPenalty = 1.0;
                    if (targetMode === 'STEAM' && (tCond - tEvap) > 80) {
                        liftPenalty = 0.85; 
                    }

                    let real_cop = cop_carnot * eta * liftPenalty;
                    if (real_cop < 1) real_cop = 1;
                    dataCOP.push(parseFloat(real_cop.toFixed(2)));
                }
            }
        }

    } else if (targetMode === 'STEAM') {
        // 标准蒸汽模式 (X轴 = 压力)
        xLabel = "饱和蒸汽压力 (MPa,a)";
        chartTitle = `蒸汽工况 COP 趋势 (热源 ${tSource}°C, η=${etaDisplay})`;
        
        for (let p = 0.1; p <= 1.2; p += 0.1) {
            let val = parseFloat(p.toFixed(1));
            labels.push(val);
            // 注意：这里传给 logic 的 targetVal 是压力，因为 calculateProcessCycle 内部会处理 STEAM 模式下的压力换算
            const res = calculateProcessCycle({ 
                mode: 'STEAM', sourceTemp: tSource, targetVal: val, perfectionDegree: eta 
            });
            dataCOP.push(res.error ? null : res.cop);
        }

    } else if (topology === 'COUPLED') {
        xLabel = "目标供水温度 (°C)";
        chartTitle = `余热提温 COP 趋势 (热源 ${tSource}°C, η=${etaDisplay})`;
        for (let t = 45; t <= 95; t += 5) {
            labels.push(t);
            const res = calculateProcessCycle({ 
                mode: 'WATER', sourceTemp: tSource, targetVal: t, perfectionDegree: eta 
            });
            dataCOP.push(res.error ? null : res.cop);
        }

    } else {
        xLabel = "室外环境温度 (°C)";
        chartTitle = `环境温变 COP 趋势 (供水 ${tCurrentTarget}°C, η=${etaDisplay})`;
        for (let t = -40; t <= 40; t += 5) {
            labels.push(t);
            const res = calculateProcessCycle({ 
                mode: 'WATER', sourceTemp: t, targetVal: tCurrentTarget, perfectionDegree: eta
            });
            dataCOP.push(res.error ? null : res.cop);
        }
    }

    // 确定 Y 轴建议最大值，优化视觉体验
    let suggestedMax = undefined;
    if (topology === 'RECOVERY') {
         if (recoveryType !== 'ABSORPTION_HP') suggestedMax = 8.0; // MVR 可能很高
         else suggestedMax = 2.5; // 吸收式很低，压低坐标轴以便看清
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'COP',
                data: dataCOP,
                // 根据技术类型改变颜色：吸收式用橙色，MVR用绿色/蓝色
                borderColor: (recoveryType === 'ABSORPTION_HP') ? '#f59e0b' : 
                             (topology === 'RECOVERY' ? '#10b981' : (targetMode === 'STEAM' ? 'rgb(236, 72, 153)' : 'rgb(79, 70, 229)')), 
                backgroundColor: 'rgba(255, 255, 255, 0.0)',
                borderWidth: 3,
                tension: 0.4,
                // 吸收式用虚线表示
                borderDash: (recoveryType === 'ABSORPTION_HP') ? [5, 5] : [],
                fill: false,
                pointRadius: 4,
                pointBackgroundColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                title: { 
                    display: true, 
                    text: chartTitle, 
                    font: { size: 14, weight: 'bold', family: "'JetBrains Mono', monospace" },
                    color: '#475569'
                },
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    padding: 10,
                    titleFont: { size: 13 },
                    bodyFont: { size: 13, weight: 'bold' },
                    callbacks: { label: (ctx) => `COP: ${ctx.raw}` }
                }
            },
            scales: {
                x: { 
                    title: { display: true, text: xLabel, font: { size: 12 } }, 
                    grid: { color: '#f1f5f9' } 
                },
                y: { 
                    title: { display: true, text: 'COP', font: { weight: 'bold' } }, 
                    grid: { borderDash: [2, 2], color: '#e2e8f0' }, 
                    min: 0,
                    suggestedMax: suggestedMax
                }
            }
        }
    });
}