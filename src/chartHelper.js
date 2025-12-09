// src/chartHelper.js - v6.5 Extended Range

import Chart from 'chart.js/auto';
import { calculateProcessCycle } from './logic.js';

let chartInstance = null;

export function updateChart(topology, targetMode, tSource, tCurrentTarget, perfectionDegree) {
    const ctx = document.getElementById('performance-chart');
    if (!ctx) return;

    if (chartInstance) chartInstance.destroy();

    let labels = [];
    let dataCOP = [];
    let xLabel = "";
    let chartTitle = "";
    
    const etaDisplay = perfectionDegree ? perfectionDegree.toFixed(2) : "Auto";

    if (targetMode === 'STEAM') {
        xLabel = "饱和蒸汽压力 (MPa,a)";
        chartTitle = `蒸汽工况 COP 趋势 (热源 ${tSource}°C, η=${etaDisplay})`;
        for (let p = 0.1; p <= 1.2; p += 0.1) {
            let val = parseFloat(p.toFixed(1));
            labels.push(val);
            const res = calculateProcessCycle({ 
                mode: 'STEAM', sourceTemp: tSource, targetVal: val, perfectionDegree: perfectionDegree 
            });
            dataCOP.push(res.error ? null : res.cop);
        }

    } else if (topology === 'COUPLED') {
        xLabel = "目标供水温度 (°C)";
        chartTitle = `余热提温 COP 趋势 (热源 ${tSource}°C, η=${etaDisplay})`;
        for (let t = 45; t <= 95; t += 5) {
            labels.push(t);
            const res = calculateProcessCycle({ 
                mode: 'WATER', sourceTemp: tSource, targetVal: t, perfectionDegree: perfectionDegree 
            });
            dataCOP.push(res.error ? null : res.cop);
        }

    } else {
        xLabel = "室外环境温度 (°C)";
        chartTitle = `环境温变 COP 趋势 (供水 ${tCurrentTarget}°C, η=${etaDisplay})`;
        
        // [v6.5 Update] Range extended to -40 ~ 40
        for (let t = -40; t <= 40; t += 5) {
            labels.push(t);
            const res = calculateProcessCycle({ 
                mode: 'WATER', sourceTemp: t, targetVal: tCurrentTarget, perfectionDegree: perfectionDegree
            });
            dataCOP.push(res.error ? null : res.cop);
        }
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `COP (η=${etaDisplay})`,
                data: dataCOP,
                borderColor: targetMode === 'STEAM' ? 'rgb(236, 72, 153)' : 'rgb(79, 70, 229)', 
                backgroundColor: targetMode === 'STEAM' ? 'rgba(236, 72, 153, 0.1)' : 'rgba(79, 70, 229, 0.1)',
                borderWidth: 3,
                tension: 0.4, 
                fill: true,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                title: { display: true, text: chartTitle, font: { size: 14, weight: 'bold' } },
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    padding: 10,
                    callbacks: { label: (ctx) => `COP: ${ctx.raw}` }
                }
            },
            scales: {
                x: { title: { display: true, text: xLabel }, grid: { color: '#f1f5f9' } },
                y: { title: { display: true, text: 'COP' }, grid: { borderDash: [2, 2] }, min: 1.0 }
            }
        }
    });
}