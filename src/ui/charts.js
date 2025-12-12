// src/ui/charts.js
import Chart from 'chart.js/auto';
import { calculateCOP } from '../core/cycles.js';
import { MODES, TOPOLOGY, RECOVERY_TYPES, LIMITS, STRATEGIES } from '../core/constants.js';
import { getSatTempFromPressure } from '../core/physics.js';

let chartInstance = null;

export function updatePerformanceChart(state, actualResult = null) {
    const ctx = document.getElementById('performance-chart');
    if (!ctx) {
        console.error("❌ 图表容器 'performance-chart' 未找到！");
        return;
    }

    console.log("📊 开始更新性能曲线图表...", state);
    if (actualResult) {
        console.log("📊 实际计算结果:", actualResult);
    }
    
    if (chartInstance) chartInstance.destroy();

    const { 
        topology, mode, steamStrategy, recoveryType, perfectionDegree, 
        targetTemp, sourceTemp, sourceOut, loadOut, isManualCop, manualCop
    } = state;

    let labels = [];
    let dataCOP = [];
    let xLabel = "";
    let chartTitle = "";

    // === [v9.1.3 Fix] 确定真实的物理目标温度 (Simulation Target) ===
    // 系统仿真逻辑(System.js)与图表绘制逻辑必须统一冷凝基准
    let simulationTargetTemp;
    
    if (topology === TOPOLOGY.RECOVERY) {
        // 方案 C: 
        // - 蒸汽模式: 目标是饱和温度 (由 targetTemp 压力计算)
        // - 热水模式: 目标是 loadOut (预热/供水出口)
        if (mode === MODES.STEAM) {
            simulationTargetTemp = getSatTempFromPressure(targetTemp);
        } else {
            simulationTargetTemp = loadOut; 
        }
    } else {
        // 方案 A/B:
        // - 蒸汽模式: 目标是饱和温度
        // - 热水模式: 目标是 targetTemp
        if (mode === MODES.STEAM) {
            simulationTargetTemp = getSatTempFromPressure(targetTemp);
        } else {
            simulationTargetTemp = targetTemp;
        }
    }

    // 🔧 修复：与实际计算逻辑保持一致（HeatPump.js 中的逻辑）
    // 对于蒸汽预热模式，热泵只能加热到 98°C（防止沸腾）
    const SAFE_PREHEAT_LIMIT = 98.0;
    let effectiveTargetTemp = simulationTargetTemp;
    
    if (topology === TOPOLOGY.RECOVERY && mode === MODES.STEAM && steamStrategy === STRATEGIES.PREHEAT) {
        if (effectiveTargetTemp > SAFE_PREHEAT_LIMIT) {
            effectiveTargetTemp = SAFE_PREHEAT_LIMIT;
            console.log(`📊 图表：蒸汽预热模式，目标温度限制为 ${SAFE_PREHEAT_LIMIT}°C（与实际计算一致）`);
        }
    }

    // 统一冷凝温度逻辑：有效目标温度 + 5K 安全余量 (与 HeatPump.js 保持一致)
    let tCond = effectiveTargetTemp + 5.0;
    
    // 如果仍然超过技术上限，使用上限值（但这种情况应该很少，因为已经限制了 98°C）
    if (tCond > LIMITS.MAX_COND_TEMP) {
        console.warn(`⚠️ 冷凝温度 ${tCond.toFixed(1)}°C 超过技术上限 ${LIMITS.MAX_COND_TEMP}°C，图表使用上限值`);
        tCond = LIMITS.MAX_COND_TEMP;
    }

    // === 1. 余热回收模式 (Scheme C) ===
    if (topology === TOPOLOGY.RECOVERY) {
        // X轴: 目标排烟温度 (5°C - 80°C)
        xLabel = "目标排烟温度 (Target Exhaust Out, °C)";
        
        const techName = (recoveryType === RECOVERY_TYPES.ABS) ? '吸收式' : 'MVR热泵';
        const manualCopNote = isManualCop ? ` [手动锁定: ${manualCop.toFixed(2)}]` : '';
        chartTitle = `深度回收特性: ${techName} (供热目标 ${effectiveTargetTemp.toFixed(1)}°C)${manualCopNote}`;

        // 🔧 修复：如果启用手动COP锁定，图表显示固定COP值
        if (isManualCop && manualCop > 0) {
            for (let tOut = 30; tOut <= 80; tOut += 5) {
                labels.push(tOut);
                dataCOP.push(manualCop);  // 所有点都使用手动COP值
            }
        } else if (recoveryType === RECOVERY_TYPES.ABS) {
            // 🔧 修复：吸收式热泵显示固定COP水平线
            // 根据模式计算固定COP值（与cycles.js逻辑一致）
            let fixedCop;
            if (mode === MODES.STEAM && steamStrategy === STRATEGIES.GEN) {
                fixedCop = 1.45;  // 直接产蒸汽模式
            } else {
                fixedCop = 1.70;  // 热水模式或补水预热模式
            }
            
            for (let tOut = 30; tOut <= 80; tOut += 5) {
                labels.push(tOut);
                dataCOP.push(fixedCop);  // 所有点都使用固定COP值，形成水平线
            }
        } else {
            // 电动热泵：基于温度计算COP曲线
            for (let tOut = 30; tOut <= 80; tOut += 5) {
                labels.push(tOut);
                
                // 物理假设：换热器端差 5K
                // 如果把排烟降到 tOut，那么热泵蒸发温度约为 tOut - 5
                const tEvap = tOut - 5.0; 

                const res = calculateCOP({
                    evapTemp: tEvap,
                    condTemp: tCond, // 使用与实际计算一致的冷凝温度
                    efficiency: perfectionDegree,
                    mode: mode,
                    strategy: steamStrategy,
                    recoveryType: recoveryType
                });
                
                // 🔧 修复：即使有错误，也尝试显示一个合理的 COP 值（用于图表展示）
                if (res.error) {
                    console.warn(`⚠️ 计算 COP 时出错 (tOut=${tOut}°C): ${res.error}`);
                    // 对于图表展示，如果计算失败，使用一个默认值或跳过
                    // 这里使用 null，Chart.js 会自动跳过该点
                    dataCOP.push(null);
                } else {
                    dataCOP.push(res.cop);
                }
            }
        }
    } 
    // === 2. 标准模式 (Scheme A/B) ===
    else {
        const stdRecType = RECOVERY_TYPES.MVR;

        if (mode === MODES.STEAM) {
            xLabel = "饱和蒸汽压力 (MPa,a)";
            const manualCopNote = isManualCop ? ` [手动锁定: ${manualCop.toFixed(2)}]` : '';
            chartTitle = `蒸汽工况 COP 趋势 (热源 ${sourceTemp}°C)${manualCopNote}`;
            
            // 🔧 修复：如果启用手动COP锁定，图表显示固定COP值
            if (isManualCop && manualCop > 0) {
                for (let p = 0.1; p <= 1.2; p += 0.1) {
                    const val = parseFloat(p.toFixed(1));
                    labels.push(val);
                    dataCOP.push(manualCop);  // 所有点都使用手动COP值
                }
            } else {
                for (let p = 0.1; p <= 1.2; p += 0.1) {
                    const val = parseFloat(p.toFixed(1));
                    labels.push(val);
                    const tSat = getSatTempFromPressure(val);
                    
                    // 动态计算该压力下的冷凝温度
                    const tCondDynamic = tSat + 8.0; // 蒸汽工况通常余量稍大

                    // 🔧 修改：方案A/B的蒸发温度计算与System.js保持一致
                    let tEvap;
                    if (topology === TOPOLOGY.PARALLEL) {
                        // 方案A：tSourceOut = tSourceIn - 5, tEvap = tSourceOut - 5 = tSourceIn - 10
                        tEvap = sourceTemp - 10.0;
                    } else {
                        // 方案B：tEvap = tSourceOut - 5
                        // 使用实际的sourceOut值（如果存在），否则使用默认差值
                        const actualSourceOut = sourceOut || (sourceTemp - 5.0);
                        tEvap = actualSourceOut - 5.0;
                    }

                    const res = calculateCOP({
                        evapTemp: tEvap,
                        condTemp: tCondDynamic,
                        efficiency: perfectionDegree,
                        mode: MODES.STEAM,
                        strategy: steamStrategy,
                        recoveryType: stdRecType 
                    });
                    dataCOP.push(res.error ? null : res.cop);
                }
            }
        } else {
            xLabel = "环境/热源温度 (°C)";
            const manualCopNote = isManualCop ? ` [手动锁定: ${manualCop.toFixed(2)}]` : '';
            chartTitle = `变工况 COP 趋势 (供水 ${simulationTargetTemp.toFixed(1)}°C)${manualCopNote}`;
            
            // 🔧 修复：如果启用手动COP锁定，图表显示固定COP值
            if (isManualCop && manualCop > 0) {
                // 🔧 修改：曲线图下限改为-40度
                for (let t = -40; t <= 40; t += 5) {
                    labels.push(t);
                    dataCOP.push(manualCop);  // 所有点都使用手动COP值
                }
            } else {
                // 🔧 修改：曲线图下限改为-40度
                for (let t = -40; t <= 40; t += 5) {
                    labels.push(t);
                    
                    // 空气源/水源 蒸发温度估算
                    // 🔧 修改：与System.js中的计算逻辑保持一致
                    let tEvap;
                    if (topology === TOPOLOGY.PARALLEL) {
                        // 方案A：进出风温差5度，蒸发温度与出风温度差值5度
                        // tSourceOut = tSourceIn - 5, tEvap = tSourceOut - 5 = tSourceIn - 10
                        const tSourceOut = t - 5.0;
                        tEvap = tSourceOut - 5.0;  // t - 10
                    } else {
                        // 方案B：tEvap = tSourceOut - 5
                        // 在图表中，t 代表热源入口温度，需要根据sourceOut计算
                        // 如果sourceOut存在，使用它；否则假设典型差值
                        const actualSourceOut = sourceOut || (t - 5.0);
                        tEvap = actualSourceOut - 5.0;
                    }
                    
                    const res = calculateCOP({
                        evapTemp: tEvap,
                        condTemp: tCond,
                        efficiency: perfectionDegree,
                        mode: MODES.WATER,
                        strategy: steamStrategy, 
                        recoveryType: stdRecType
                    });
                    dataCOP.push(res.error ? null : res.cop);
                }
            }
        }
    }

    console.log("📊 图表数据:", { labels, dataCOP, xLabel, chartTitle });
    
    // 🔧 验证数据：检查是否有有效数据点
    const validDataCount = dataCOP.filter(v => v !== null && v !== undefined).length;
    if (validDataCount === 0) {
        console.error("❌ 图表数据全部无效！所有 COP 值都是 null");
        // 即使数据无效，也尝试绘制一个空图表，至少显示坐标轴
    } else {
        console.log(`✅ 有效数据点: ${validDataCount}/${dataCOP.length}`);
    }
    
    // 🔧 修复：添加实际运行点标记（所有方案）
    let actualPointData = null;
    let targetPointData = null;
    
    if (actualResult) {
        if (topology === TOPOLOGY.RECOVERY) {
            // 方案C：实际运行点使用实际排烟温度
            const actualFlueOut = actualResult.reqData?.sourceOut || actualResult.sourceOut;
            if (actualFlueOut) {
                const actualIndex = labels.findIndex((label, idx) => {
                    return Math.abs(label - actualFlueOut) < 2.5; // 找到最接近的点
                });
                if (actualIndex >= 0) {
                    actualPointData = {
                        x: labels[actualIndex],
                        y: actualResult.cop,  // 使用实际计算的COP值
                        label: `实际运行点 (${actualFlueOut.toFixed(1)}°C, COP=${actualResult.cop.toFixed(2)})`
                    };
                }
            }
            
            // 目标运行点：使用用户输入的目标排烟温度
            const targetFlueOut = state.flueOut;
            if (targetFlueOut && actualFlueOut && targetFlueOut !== actualFlueOut) {
                const targetIndex = labels.findIndex((label, idx) => {
                    return Math.abs(label - targetFlueOut) < 2.5;
                });
                if (targetIndex >= 0 && dataCOP[targetIndex] !== null) {
                    targetPointData = {
                        x: labels[targetIndex],
                        y: dataCOP[targetIndex],
                        label: `目标运行点 (${targetFlueOut.toFixed(1)}°C, COP=${dataCOP[targetIndex].toFixed(2)})`
                    };
                }
            }
        } else {
            // 方案A/B：实际运行点使用当前热源温度
            if (mode === MODES.WATER) {
                // 热水模式：X轴是环境/热源温度
                const currentSourceTemp = sourceTemp;
                const actualIndex = labels.findIndex((label, idx) => {
                    return Math.abs(label - currentSourceTemp) < 2.5;
                });
                if (actualIndex >= 0) {
                    // 🔧 确保使用实际计算的COP值，而不是图表曲线上的值
                    actualPointData = {
                        x: labels[actualIndex],
                        y: actualResult.cop,  // 使用实际计算的COP值
                        label: `实际运行点 (${currentSourceTemp.toFixed(1)}°C, COP=${actualResult.cop.toFixed(2)})`
                    };
                }
            } else {
                // 蒸汽模式：X轴是饱和蒸汽压力
                const currentPressure = targetTemp;
                const actualIndex = labels.findIndex((label, idx) => {
                    return Math.abs(label - currentPressure) < 0.05;
                });
                if (actualIndex >= 0) {
                    actualPointData = {
                        x: labels[actualIndex],
                        y: actualResult.cop,  // 使用实际计算的COP值
                        label: `实际运行点 (${currentPressure.toFixed(2)}MPa, COP=${actualResult.cop.toFixed(2)})`
                    };
                }
            }
        }
    }
    
    const datasets = [{
        label: 'Heat Pump COP', // [UI Fix] 明确是热泵机组 COP
        data: dataCOP,
        borderColor: (topology === TOPOLOGY.RECOVERY && recoveryType === RECOVERY_TYPES.ABS) ? '#f59e0b' : '#10b981', 
        borderWidth: 3,
        tension: 0.4,
        pointBackgroundColor: '#fff',
        pointRadius: 3
    }];
    
    // 添加实际运行点
    if (actualPointData) {
        datasets.push({
            label: '实际运行点',
            data: [actualPointData],
            borderColor: '#ef4444',
            backgroundColor: '#ef4444',
            pointRadius: 8,
            pointHoverRadius: 10,
            showLine: false,
            pointStyle: 'circle'
        });
    }
    
    // 添加目标运行点（如果与实际点不同）
    if (targetPointData && (!actualPointData || Math.abs(targetPointData.x - actualPointData.x) > 5)) {
        datasets.push({
            label: '目标运行点',
            data: [targetPointData],
            borderColor: '#3b82f6',
            backgroundColor: '#3b82f6',
            pointRadius: 6,
            pointHoverRadius: 8,
            showLine: false,
            pointStyle: 'triangle'
        });
    }
    
    try {
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: chartTitle },
                    tooltip: { 
                        callbacks: { 
                            label: (context) => {
                                if (context.dataset.label === '实际运行点' || context.dataset.label === '目标运行点') {
                                    return context.dataset.label + `: COP=${context.raw.toFixed(2)}`;
                                }
                                return `COP: ${context.raw.toFixed(2)}`;
                            }
                        } 
                    },
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    y: { min: 0, suggestedMax: 6.0 },
                    x: { title: { display: true, text: xLabel } }
                }
            }
        });
        console.log("✅ 图表绘制成功！");
    } catch (error) {
        console.error("❌ 图表绘制失败:", error);
    }
}