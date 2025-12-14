// src/ui/main.js
import '../style.css'; 
import { store, getDefaultValuesA, getDefaultValuesB, getDefaultValuesC } from '../state/store.js';
import { System } from '../models/System.js';
import { Boiler } from '../models/Boiler.js'; // 用于计算烟气量
import { fetchSchemeC } from '../core/api.js'; // 用于呼叫 Python
import { updatePerformanceChart } from './charts.js';
import { renderSystemDiagram } from './diagram.js'; 
import { MODES, TOPOLOGY, STRATEGIES, FUEL_DB, RECOVERY_TYPES } from '../core/constants.js';
import { getSatTempFromPressure, convertSteamTonsToKW, calculateWaterCondensation, calculateAdjustedDewPoint, calculateAtmosphericPressure } from '../core/physics.js';
import { calculateCOP } from '../core/cycles.js';

// === Unit Options ===
const CAL_UNIT_OPTIONS = [
    { value: 'MJ/kg', text: 'MJ/unit', factor: 1.0 },
    { value: 'kWh/kg', text: 'kWh/unit', factor: 0.277778 }, 
    { value: 'MJ/m3', text: 'MJ/m³', factor: 1.0 },
    { value: 'kWh/m3', text: 'kWh/m³', factor: 0.277778 }
];

const CO2_UNIT_OPTIONS = [
    { value: 'kgCO2/unit', text: 'kg/Unit', factor: 1.0 }, 
    { value: 'kgCO2/kWh', text: 'kg/kWh', factor: 1.0 } 
];

function populateUnitSelect(selectEl, options, currentUnit) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.innerText = opt.text;
        if (opt.value === currentUnit) {
             option.selected = true;
        }
        selectEl.appendChild(option);
    });
}

function findUnitFactor(unit, options) {
    const opt = options.find(o => o.value === unit);
    return opt ? opt.factor : 1.0;
}

// === 1. DOM 元素映射 ===
const ui = {
    topo: document.getElementById('select-topology'),
    btnWater: document.getElementById('btn-mode-water'),
    btnSteam: document.getElementById('btn-mode-steam'),
    inpMode: document.getElementById('input-target-mode'),
    
    selFuel: document.getElementById('select-fuel'),
    inpElecPrice: document.getElementById('input-elec-price'),
    inpFuelPrice: document.getElementById('input-fuel-price'),
    lblFuelUnit: document.getElementById('label-fuel-unit'),
    
    inpCapexHP: document.getElementById('inp-capex-hp'),
    inpCapexBase: document.getElementById('inp-capex-base'),

    panelStd: document.getElementById('panel-input-standard'),
    panelRec: document.getElementById('panel-input-recovery'),
    boxTargetStd: document.getElementById('box-target-std'),
    boxSteamStrat: document.getElementById('box-steam-strategy'),
    
    inpSource: document.getElementById('input-temp-source'),
    inpSourceOut: document.getElementById('input-temp-source-out'), 
    boxSourceOut: document.getElementById('box-source-out'), 
    unitSourceIn: document.getElementById('unit-source-in'), 
    
    inpFlueIn: document.getElementById('input-flue-temp-in'),
    inpFlueOut: document.getElementById('input-flue-temp-out'),
    
    inpLoadIn: document.getElementById('input-load-in'),
    inpLoadOut: document.getElementById('input-load-out'),
    lblLoadIn: document.getElementById('label-load-in'),
    lblLoadOut: document.getElementById('label-load-out'),
    
    inpLoadInStd: document.getElementById('input-load-in-std'), 
    boxLoadInStd: document.getElementById('box-load-in-std'), 

    selSteamStrat: document.getElementById('select-steam-strategy'),
    selRecType: document.getElementById('select-recovery-type'),
    inpPefElec: document.getElementById('inp-pef-elec'),
    inpExcessAir: document.getElementById('inp-excess-air'),

    inpTarget: document.getElementById('input-target-val'),
    lblTarget: document.getElementById('label-target-val'),
    unitTarget: document.getElementById('unit-target-val'),
    resSatTemp: document.getElementById('res-sat-temp'),
    boxSteamInfo: document.getElementById('steam-info-box'),

    resPayback: document.getElementById('res-payback'),
    selPerfection: document.getElementById('sel-perfection'),
    inpPerfectionCustom: document.getElementById('inp-perfection-custom'),
    boxPerfCustom: document.getElementById('box-perf-custom'),
    chkManualCop: document.getElementById('chk-manual-cop'),
    inpManualCop: document.getElementById('inp-manual-cop'),
    inpFuelCal: document.getElementById('inp-fuel-cal'),
    selUnitCal: document.getElementById('sel-unit-cal'),
    inpFuelCo2: document.getElementById('inp-fuel-co2'),
    selUnitCo2: document.getElementById('sel-unit-co2'),
    inpFuelEff: document.getElementById('inp-fuel-eff'),
    inpAnnualHours: document.getElementById('input-annual-hours'),
    inpAltitude: document.getElementById('inp-altitude'),
    valAtmosphericPressure: document.getElementById('val-atmospheric-pressure'),
    
    inpLoad: document.getElementById('input-load'),
    inpLoadTon: document.getElementById('input-load-ton'),
    selLoadUnit: document.getElementById('select-load-unit'),
    valLoadConv: document.getElementById('val-load-converted'),
    infoLoadConv: document.getElementById('info-load-converted'),
    unitLoadDisplay: document.getElementById('unit-load-display'), 

    btnCalc: document.getElementById('btn-calculate'),

    resCost: document.getElementById('res-cost'),         
    
    lblCop: document.getElementById('lbl-res-1'),
    resCop: document.getElementById('res-cop'),
    resLift: document.getElementById('res-lift'),
    
    // PER 卡片元素
    resPer: document.getElementById('res-per'),
    
    resCo2Red: document.getElementById('res-co2-red'),
    resUnitCost: document.getElementById('res-unit-cost'), 
    resAnnualSave: document.getElementById('res-annual-save'), 
    
    valCapTotal: document.getElementById('val-cap-total'),
    valCapTon: document.getElementById('val-cap-ton'),
    valCapBreakdown: document.getElementById('val-cap-breakdown'),
    
    // 选型单相关按钮 (现在已隐藏，但保留引用以防报错)
    btnGenReq: document.getElementById('btn-gen-req'),
    modalReq: document.getElementById('modal-requisition'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    btnCopyReq: document.getElementById('btn-copy-req'),
    reqSourceType: document.getElementById('req-source-type'),
    reqSourceIn: document.getElementById('req-source-in'),
    reqSourceOut: document.getElementById('req-source-out'),
    reqLoadType: document.getElementById('req-load-type'),
    reqLoadIn: document.getElementById('req-load-in'),
    reqLoadOut: document.getElementById('req-load-out'),
    reqCapacity: document.getElementById('req-capacity'),

    log: document.getElementById('system-log')
};

let currentReqData = null;

// 🔧 修复：燃料参数缓存机制 - 为每个燃料类型保存用户自定义的参数
// 格式: { [fuelType]: { fuelCalValue, fuelCalUnit, fuelCo2Value, fuelCo2Unit, boilerEff } }
const fuelParamsCache = {};

/**
 * 🔧 修复：更新当前燃料类型的参数缓存
 * 当用户手动修改参数时调用此函数
 */
function updateFuelParamsCache() {
    const state = store.getState();
    const fuelType = state.fuelType;
    if (fuelType) {
        fuelParamsCache[fuelType] = {
            fuelCalValue: state.fuelCalValue,
            fuelCalUnit: state.fuelCalUnit,
            fuelCo2Value: state.fuelCo2Value,
            fuelCo2Unit: state.fuelCo2Unit,
            boilerEff: state.boilerEff
        };
    }
}

// === 辅助函数 ===
function resetFuelParams(fuelType) {
    const currentState = store.getState();
    const currentFuelType = currentState.fuelType;
    
    // 🔧 修复：切换前，保存当前燃料类型的自定义参数到缓存
    if (currentFuelType && currentFuelType !== fuelType) {
        fuelParamsCache[currentFuelType] = {
            fuelCalValue: currentState.fuelCalValue,
            fuelCalUnit: currentState.fuelCalUnit,
            fuelCo2Value: currentState.fuelCo2Value,
            fuelCo2Unit: currentState.fuelCo2Unit,
            boilerEff: currentState.boilerEff
        };
        console.log(`💾 已保存 ${currentFuelType} 的自定义参数到缓存`, fuelParamsCache[currentFuelType]);
    }
    
    // 获取目标燃料类型的默认值
    const db = FUEL_DB[fuelType] || FUEL_DB['NATURAL_GAS'];
    let bestCalUnit = 'MJ/kg'; 
    if (db.unit === 'm³') bestCalUnit = 'MJ/m3';
    
    // 🔧 修复：检查是否有该燃料类型的缓存参数，如果有则使用缓存值，否则使用默认值
    const cachedParams = fuelParamsCache[fuelType];
    const updates = {
        fuelType: fuelType,
        fuelCalValue: cachedParams?.fuelCalValue ?? db.calorificValue, 
        fuelCalUnit: cachedParams?.fuelCalUnit ?? bestCalUnit,
        fuelCo2Value: cachedParams?.fuelCo2Value ?? db.co2Factor,     
        fuelCo2Unit: cachedParams?.fuelCo2Unit ?? 'kgCO2/unit',
        boilerEff: cachedParams?.boilerEff ?? (db.defaultEfficiency || (fuelType === 'ELECTRICITY' ? 0.99 : 0.92))
    };

    if (fuelType === 'ELECTRICITY') {
        const currentElecPrice = parseFloat(ui.inpElecPrice.value) || 0.75;
        updates.fuelPrice = currentElecPrice;
    }

    store.setState(updates);
    populateUnitSelect(ui.selUnitCal, CAL_UNIT_OPTIONS, updates.fuelCalUnit);
    populateUnitSelect(ui.selUnitCo2, CO2_UNIT_OPTIONS, updates.fuelCo2Unit);
    
    const logMsg = cachedParams 
        ? `🔄 燃料切换: ${db.name} (已恢复自定义参数)` 
        : `🔄 燃料切换: ${db.name} (使用默认参数)`;
    log(logMsg, 'info');
}

function updatePriceInterlock(fuelType) {
    if (!ui.inpFuelPrice) return;
    if (fuelType === 'ELECTRICITY') {
        ui.inpFuelPrice.disabled = true;
        ui.inpFuelPrice.classList.add('bg-slate-100', 'text-slate-400', 'cursor-not-allowed');
    } else {
        ui.inpFuelPrice.disabled = false;
        ui.inpFuelPrice.classList.remove('bg-slate-100', 'text-slate-400', 'cursor-not-allowed');
    }
}

function renderDecisionBanner(decision) {
    const panel = ui.resCost.closest('.bg-white.rounded-xl.shadow-md');
    if (!panel) return;

    const existingBanner = panel.querySelector('#decision-banner');
    if (existingBanner) existingBanner.remove();

    if (!decision) return;

    const banner = document.createElement('div');
    banner.id = 'decision-banner';
    banner.className = `px-4 py-3 border-b ${decision.class || 'bg-slate-50 border-slate-200'} flex flex-col md:flex-row justify-between items-center gap-2 transition-all duration-500`;
    
    banner.innerHTML = `
        <div class="flex items-center gap-2">
            <span class="text-lg">${decision.level === 'STRONG' ? '🏆' : (decision.level === 'MARGINAL' ? '⚖️' : '🛑')}</span>
            <span class="text-xs md:text-sm font-bold">${decision.title}</span>
        </div>
        <div class="text-[10px] md:text-xs font-medium opacity-90">${decision.desc}</div>
    `;

    const header = panel.firstElementChild;
    if (header) {
        header.insertAdjacentElement('afterend', banner);
    }
}

function getEfficiencyCardContainer() {
    let container = document.getElementById('efficiency-card-panel');
    if (!container && ui.resPer) {
        container = ui.resPer.closest('.bg-white.p-4');
        if (container) container.id = 'efficiency-card-panel';
    }
    return container;
}

function renderCouplingDashboard(couplingData) {
    const parent = getEfficiencyCardContainer();
    if (!parent) return; 

    const headerHtml = `<div class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">综合效能对比 (EFFICIENCY)</div>`;
    const { site, per } = couplingData;
    
    const bodyHtml = `
        <div class="mt-2 space-y-2">
            <div class="flex justify-between items-end border-b border-violet-100 pb-1">
                <div class="text-[10px] text-slate-500">Site Eff. (终端)</div>
                <div class="text-right">
                    <div class="text-xs font-bold text-slate-700">${site.before.toFixed(1)}% <span class="text-slate-400">-></span> <span class="text-violet-700">${site.after.toFixed(1)}%</span></div>
                    <div class="text-[9px] text-emerald-500 font-bold">⬆ +${site.delta.toFixed(1)} pts</div>
                </div>
            </div>
            <div class="flex justify-between items-end">
                <div class="text-[10px] text-slate-500">PER (一次能源)</div>
                <div class="text-right">
                    <div class="text-xs font-bold text-slate-700">${per.before.toFixed(2)} <span class="text-slate-400">-></span> <span class="text-violet-700">${per.after.toFixed(2)}</span></div>
                    <div class="text-[9px] text-emerald-500 font-bold">⬆ +${per.delta.toFixed(2)}</div>
                </div>
            </div>
        </div>
    `;
    
    parent.innerHTML = headerHtml + bodyHtml;
}

function renderStandardPER(val) {
    const parent = getEfficiencyCardContainer();
    if (!parent) return;

    parent.innerHTML = `
        <div class="text-[10px] uppercase font-bold text-slate-400 tracking-wider" id="lbl-res-3">一次能源利用率 (PER)</div>
        <div class="text-2xl font-bold text-violet-700 mt-1" id="res-per">${val}</div>
        <div class="text-[10px] text-violet-500 font-medium" id="desc-res-3">Efficiency</div>
    `;
    ui.resPer = document.getElementById('res-per');
}

/**
 * [新增] 直接在界面上渲染选型参数 (调试用)
 */
function renderTechSpecDirectly(reqData) {
    const costEl = document.getElementById('res-cost');
    if (!costEl) return;
    
    const container = costEl.closest('.bg-white.rounded-xl');
    if (!container) return;

    const oldPanel = document.getElementById('debug-tech-panel');
    if (oldPanel) oldPanel.remove();

    if (!reqData) return;

    const panel = document.createElement('div');
    panel.id = 'debug-tech-panel';
    panel.className = "mt-4 mx-4 mb-4 p-3 bg-slate-100 rounded-lg border border-slate-200 text-xs font-mono shadow-inner";
    
    // 🔧 构建热源成分显示字符串
    let compositionStr = "N/A";
    if (reqData.sourceComposition) {
        const comp = reqData.sourceComposition;
        // 根据成分类型构建显示字符串
        const parts = [];
        
        // 🔧 修复：确保值是数字类型再调用toFixed
        const safeToFixed = (value, decimals) => {
            if (value === null || value === undefined) return null;
            const num = typeof value === 'number' ? value : parseFloat(value);
            return isNaN(num) ? null : num.toFixed(decimals);
        };
        
        const h2o = safeToFixed(comp.h2o, 1);
        const co2 = safeToFixed(comp.co2, 2);
        const n2 = safeToFixed(comp.n2, 1);
        const o2 = safeToFixed(comp.o2, 1);
        const ar = safeToFixed(comp.ar, 2);
        
        if (h2o !== null && parseFloat(h2o) > 0) parts.push(`H₂O: ${h2o}%`);
        if (co2 !== null && parseFloat(co2) > 0) parts.push(`CO₂: ${co2}%`);
        if (n2 !== null && parseFloat(n2) > 0) parts.push(`N₂: ${n2}%`);
        if (o2 !== null && parseFloat(o2) > 0) parts.push(`O₂: ${o2}%`);
        if (ar !== null && parseFloat(ar) > 0) parts.push(`Ar: ${ar}%`);
        
        compositionStr = parts.length > 0 ? parts.join(', ') : "N/A";
    }
    
    // 🔧 构建流量显示
    const sourceFlowVolStr = reqData.sourceFlowVol ? `${reqData.sourceFlowVol.toFixed(1)} m³/h` : "N/A";
    const sourceFlowMassStr = reqData.sourceFlowMass ? `${reqData.sourceFlowMass.toFixed(1)} kg/h` : "N/A";
    const sinkFlowMassStr = reqData.sinkFlowMass ? `${reqData.sinkFlowMass.toFixed(1)} kg/h` : "N/A";
    
    panel.innerHTML = `
        <div class="flex items-center justify-between mb-2 border-b border-slate-300 pb-1">
            <span class="font-bold text-slate-600">🛠️ 厂家选型单参数 (DEBUG)</span>
            <span class="text-[10px] text-slate-400">Auto-Generated</span>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-2">
            <div class="col-span-2 sm:col-span-1">
                <div class="text-[10px] text-slate-400">热源 (Source)</div>
                <div class="font-bold text-slate-700 truncate">${reqData.sourceType}</div>
                <div class="text-slate-600">
                    <span class="font-bold">${reqData.sourceIn.toFixed(1)}°C</span> 
                    <span class="text-slate-400">-></span> 
                    <span class="font-bold">${reqData.sourceOut.toFixed(1)}°C</span>
                </div>
            </div>
            
            <div class="col-span-2 sm:col-span-1">
                <div class="text-[10px] text-slate-400">热汇 (Load)</div>
                <div class="font-bold text-slate-700 truncate">${reqData.loadType}</div>
                <div class="text-slate-600">
                    <span class="font-bold">${reqData.loadIn.toFixed(1)}°C</span> 
                    <span class="text-slate-400">-></span> 
                    <span class="font-bold">${reqData.loadOut.toFixed(1)}°C</span>
                </div>
            </div>

            <div class="col-span-2 border-t border-slate-300 pt-1 mt-1">
                <div class="text-slate-500 mb-1">制热量 (Capacity):</div>
                <div class="text-sm font-bold text-indigo-600">${reqData.capacity.toLocaleString(undefined, {maximumFractionDigits: 0})} kW</div>
            </div>
            
            <div class="col-span-2 border-t border-slate-300 pt-2 mt-1">
                <div class="text-[10px] text-slate-400 mb-1">热源成分组成 (Source Composition)</div>
                <div class="text-xs text-slate-700 font-mono">${compositionStr}</div>
            </div>
            
            <div class="col-span-2 sm:col-span-1 border-t border-slate-300 pt-2 mt-1">
                <div class="text-[10px] text-slate-400 mb-1">热源体积流量 (Source Vol. Flow)</div>
                <div class="text-xs font-bold text-slate-700">${sourceFlowVolStr}</div>
            </div>
            
            <div class="col-span-2 sm:col-span-1 border-t border-slate-300 pt-2 mt-1">
                <div class="text-[10px] text-slate-400 mb-1">热源质量流量 (Source Mass Flow)</div>
                <div class="text-xs font-bold text-slate-700">${sourceFlowMassStr}</div>
            </div>
            
            <div class="col-span-2 border-t border-slate-300 pt-2 mt-1">
                <div class="text-[10px] text-slate-400 mb-1">热汇流量 (Sink Flow)</div>
                <div class="text-xs font-bold text-slate-700">${sinkFlowMassStr}</div>
            </div>
            
            ${reqData.waterCondensation ? `
            <div class="col-span-2 border-t border-slate-300 pt-2 mt-1">
                <div class="text-[10px] text-slate-400 mb-1">水分析出量 (Water Condensation)</div>
                <div class="text-xs font-bold text-blue-600">
                    ${reqData.waterCondensation.condensedWater > 0 
                        ? `${reqData.waterCondensation.condensedWater.toFixed(2)} kg/h` 
                        : '无析出'}
                </div>
                ${reqData.waterCondensation.condensedWater > 0 ? `
                <div class="text-[9px] text-slate-500 mt-1">
                    初始水蒸气: ${reqData.waterCondensation.initialWater.toFixed(2)} kg/h → 
                    最终水蒸气: ${reqData.waterCondensation.finalWater.toFixed(2)} kg/h
                </div>
                ` : ''}
            </div>
            ` : ''}
        </div>
    `;

    container.appendChild(panel);
    
    // 顺手隐藏旧按钮
    const btn = document.getElementById('btn-gen-req');
    if (btn) btn.style.display = 'none'; 
}

// === 3. 事件绑定 ===
function bindEvents() {
    ui.topo.addEventListener('change', (e) => {
        const newTopo = e.target.value;
        const currentMode = store.getState().mode;
        const updates = { topology: newTopo };
        
        // 根据新方案和当前模式设置对应的默认值
        if (newTopo === TOPOLOGY.PARALLEL) {
            Object.assign(updates, getDefaultValuesA(currentMode));
        } else if (newTopo === TOPOLOGY.COUPLED) {
            Object.assign(updates, getDefaultValuesB(currentMode));
        } else if (newTopo === TOPOLOGY.RECOVERY) {
            Object.assign(updates, getDefaultValuesC(currentMode));
        }
        
        store.setState(updates);
    });

    ui.btnWater.addEventListener('click', () => {
        const currentTopo = store.getState().topology;
        const updates = { mode: MODES.WATER };
        
        // 根据当前方案设置热水模式的默认值
        if (currentTopo === TOPOLOGY.PARALLEL) {
            Object.assign(updates, getDefaultValuesA(MODES.WATER));
        } else if (currentTopo === TOPOLOGY.COUPLED) {
            Object.assign(updates, getDefaultValuesB(MODES.WATER));
        } else if (currentTopo === TOPOLOGY.RECOVERY) {
            Object.assign(updates, getDefaultValuesC(MODES.WATER));
        }
        
        store.setState(updates);
    });

    ui.btnSteam.addEventListener('click', () => {
        const currentTopo = store.getState().topology;
        const updates = { mode: MODES.STEAM };
        
        // 根据当前方案设置蒸汽模式的默认值
        if (currentTopo === TOPOLOGY.PARALLEL) {
            Object.assign(updates, getDefaultValuesA(MODES.STEAM));
        } else if (currentTopo === TOPOLOGY.COUPLED) {
            Object.assign(updates, getDefaultValuesB(MODES.STEAM));
        } else if (currentTopo === TOPOLOGY.RECOVERY) {
            Object.assign(updates, getDefaultValuesC(MODES.STEAM));
        }
        
        store.setState(updates);
    });

    if (ui.selFuel) {
        ui.selFuel.addEventListener('change', (e) => {
            const newFuel = e.target.value;
            resetFuelParams(newFuel);
            updatePriceInterlock(newFuel);
        });
    }

    if (ui.inpElecPrice) {
        ui.inpElecPrice.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            const s = store.getState();
            const updates = { elecPrice: val };
            if (s.fuelType === 'ELECTRICITY') updates.fuelPrice = val;
            store.setState(updates);
        });
    }

    if (ui.inpFuelPrice) {
        ui.inpFuelPrice.addEventListener('input', (e) => {
            const s = store.getState();
            if (s.fuelType !== 'ELECTRICITY') store.setState({ fuelPrice: parseFloat(e.target.value) });
        });
    }

    const bindInput = (el, key, isFloat = true) => {
        if(!el) return;
        el.addEventListener('input', (e) => {
            const val = isFloat ? parseFloat(e.target.value) : e.target.value;
            store.setState({ [key]: val });
        });
    };

    bindInput(ui.inpSource, 'sourceTemp');
    bindInput(ui.inpSourceOut, 'sourceOut'); 
    bindInput(ui.inpLoadInStd, 'loadInStd'); 
    bindInput(ui.inpFlueIn, 'flueIn');
    bindInput(ui.inpFlueOut, 'flueOut');
    bindInput(ui.inpLoadIn, 'loadIn');
    bindInput(ui.inpLoadOut, 'loadOut');
    bindInput(ui.inpTarget, 'targetTemp');
    bindInput(ui.inpLoad, 'loadValue'); 
    bindInput(ui.inpAnnualHours, 'annualHours');
    bindInput(ui.inpExcessAir, 'excessAir');
    
    // 🔧 修复：绑定燃料参数输入时，同时更新缓存
    if (ui.inpFuelCal) {
        ui.inpFuelCal.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            store.setState({ fuelCalValue: val });
            updateFuelParamsCache(); // 更新缓存
        });
    }
    if (ui.inpFuelCo2) {
        ui.inpFuelCo2.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            store.setState({ fuelCo2Value: val });
            updateFuelParamsCache(); // 更新缓存
        });
    }
    if (ui.inpFuelEff) {
        ui.inpFuelEff.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            store.setState({ boilerEff: val });
            updateFuelParamsCache(); // 更新缓存
        });
    }
    bindInput(ui.inpPefElec, 'pefElec');
    bindInput(ui.inpPerfectionCustom, 'perfectionDegree');
    bindInput(ui.inpCapexHP, 'capexHP');
    bindInput(ui.inpCapexBase, 'capexBase');
    bindInput(ui.inpAltitude, 'altitude');
    
    // 海拔输入时实时更新大气压力显示
    if (ui.inpAltitude) {
        ui.inpAltitude.addEventListener('input', (e) => {
            const altitude = parseFloat(e.target.value) || 0;
            store.setState({ altitude });
            const atmPressure = calculateAtmosphericPressure(altitude);
            if (ui.valAtmosphericPressure) {
                ui.valAtmosphericPressure.innerText = atmPressure.toFixed(3);
            }
            // 触发UI更新以重新计算饱和温度
            const s = store.getState();
            if (s.mode === MODES.STEAM && ui.inpTarget) {
                const event = new Event('input', { bubbles: true });
                ui.inpTarget.dispatchEvent(event);
            }
        });
    }
    
    if (ui.selPerfection) {
        ui.selPerfection.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'CUSTOM') {
                ui.boxPerfCustom.classList.remove('hidden');
            } else {
                ui.boxPerfCustom.classList.add('hidden');
                store.setState({ perfectionDegree: parseFloat(val) });
            }
        });
    }
    
    if (ui.selUnitCal) {
        ui.selUnitCal.addEventListener('change', (e) => {
            const newUnit = e.target.value;
            const s = store.getState();
            const oldUnit = s.fuelCalUnit;
            const oldFactor = findUnitFactor(oldUnit, CAL_UNIT_OPTIONS);
            const newFactor = findUnitFactor(newUnit, CAL_UNIT_OPTIONS);
            const ratio = oldFactor / newFactor;
            store.setState({ fuelCalValue: s.fuelCalValue * ratio, fuelCalUnit: newUnit });
            updateFuelParamsCache(); // 🔧 修复：更新缓存
        });
    }

    if (ui.selUnitCo2) {
        ui.selUnitCo2.addEventListener('change', (e) => {
            store.setState({ fuelCo2Unit: e.target.value });
            updateFuelParamsCache(); // 🔧 修复：更新缓存
        });
    }
    
    const manualCopInputHandler = (e) => store.setState({ manualCop: parseFloat(e.target.value) });
    const manualCopChangeHandler = (e) => {
        const isManual = e.target.checked;
        ui.inpManualCop.disabled = !isManual;
        store.setState({ isManualCop: isManual });
    };
    if (ui.chkManualCop) ui.chkManualCop.addEventListener('change', manualCopChangeHandler);
    if (ui.inpManualCop) ui.inpManualCop.addEventListener('input', manualCopInputHandler);

    if(ui.selSteamStrat) ui.selSteamStrat.addEventListener('change', (e) => store.setState({ steamStrategy: e.target.value }));
    if(ui.selRecType) ui.selRecType.addEventListener('change', (e) => store.setState({ recoveryType: e.target.value }));

    if (ui.selLoadUnit) ui.selLoadUnit.addEventListener('change', (e) => store.setState({ loadUnit: e.target.value }));

    if (ui.inpLoadTon) {
        ui.inpLoadTon.addEventListener('input', (e) => {
            const tons = parseFloat(e.target.value) || 0;
            const kw = convertSteamTonsToKW(tons);
            store.setState({ loadValue: kw, loadValueTons: tons }); 
        });
    }

    if (ui.btnCalc) ui.btnCalc.addEventListener('click', () => runSimulation());

    // 弹窗相关事件保留，防止找不到ID报错，但按钮实际上会被 renderTechSpecDirectly 隐藏
    if (ui.btnCloseModal) ui.btnCloseModal.addEventListener('click', () => ui.modalReq.classList.add('hidden'));
}

// === 4. 界面渲染 ===
store.subscribe((state) => {
    const { 
        topology, mode, targetTemp, sourceTemp, sourceOut, loadInStd, recoveryType, loadUnit, loadValue, loadValueTons, 
        fuelCalValue, fuelCalUnit, fuelCo2Value, fuelCo2Unit, perfectionDegree, isManualCop, manualCop,
        fuelType, elecPrice, fuelPrice, altitude
    } = state;
    
    // 更新大气压力显示
    if (ui.valAtmosphericPressure && altitude !== undefined) {
        const atmPressure = calculateAtmosphericPressure(altitude || 0);
        ui.valAtmosphericPressure.innerText = atmPressure.toFixed(3);
    }

    if (ui.topo.value !== topology) ui.topo.value = topology;
    if (ui.selRecType && ui.selRecType.value !== recoveryType) ui.selRecType.value = recoveryType;
    if (ui.selFuel && ui.selFuel.value !== fuelType) ui.selFuel.value = fuelType;
    if (document.activeElement !== ui.inpElecPrice) ui.inpElecPrice.value = elecPrice;
    
    // 🔧 修复：方案C + 吸收式热泵时，电价不参与计算，禁用并变灰电价输入框
    const isAbsorptionInRecovery = (topology === TOPOLOGY.RECOVERY && recoveryType === RECOVERY_TYPES.ABS);
    if (ui.inpElecPrice) {
        // 查找电价标签（label是input的父div的兄弟元素）
        const inputContainer = ui.inpElecPrice.closest('.relative');
        const elecPriceLabel = inputContainer?.parentElement?.querySelector('label');
        
        if (isAbsorptionInRecovery) {
            ui.inpElecPrice.disabled = true;
            ui.inpElecPrice.classList.add('bg-slate-100', 'text-slate-400', 'cursor-not-allowed');
            // 标签也变灰
            if (elecPriceLabel) {
                elecPriceLabel.classList.add('text-slate-400', 'opacity-60');
            }
            // 添加提示
            ui.inpElecPrice.title = '吸收式热泵模式下，驱动使用燃料而非电力，电价不参与计算';
        } else {
            ui.inpElecPrice.disabled = false;
            ui.inpElecPrice.classList.remove('bg-slate-100', 'text-slate-400', 'cursor-not-allowed');
            // 恢复标签颜色
            if (elecPriceLabel) {
                elecPriceLabel.classList.remove('text-slate-400', 'opacity-60');
            }
            ui.inpElecPrice.title = '';
        }
    }
    
    updatePriceInterlock(fuelType);
    if (document.activeElement !== ui.inpFuelPrice) {
        ui.inpFuelPrice.value = fuelPrice;
    }
    
    if (ui.lblFuelUnit) {
        const db = FUEL_DB[fuelType];
        ui.lblFuelUnit.innerText = `/${db ? db.unit : 'unit'}`;
    }

    if (document.activeElement !== ui.inpTarget) ui.inpTarget.value = targetTemp;
    if (document.activeElement !== ui.inpLoadInStd) ui.inpLoadInStd.value = loadInStd;
    if (document.activeElement !== ui.inpSource) ui.inpSource.value = sourceTemp;
    if (document.activeElement !== ui.inpSourceOut) ui.inpSourceOut.value = sourceOut;
    // 🔧 修复：添加 flueIn 和 flueOut 的同步更新
    if (document.activeElement !== ui.inpFlueIn) ui.inpFlueIn.value = state.flueIn;
    if (document.activeElement !== ui.inpFlueOut) ui.inpFlueOut.value = state.flueOut;
    if (document.activeElement !== ui.inpLoadIn) ui.inpLoadIn.value = state.loadIn;
    if (document.activeElement !== ui.inpLoadOut) ui.inpLoadOut.value = state.loadOut;

    if (ui.inpExcessAir && document.activeElement !== ui.inpExcessAir) {
        ui.inpExcessAir.value = state.excessAir;
    }
    
    if (document.activeElement !== ui.inpFuelCal) ui.inpFuelCal.value = fuelCalValue.toFixed(2);
    if (ui.selUnitCal && ui.selUnitCal.value !== fuelCalUnit) ui.selUnitCal.value = fuelCalUnit;
    
    if (document.activeElement !== ui.inpFuelCo2) ui.inpFuelCo2.value = fuelCo2Value.toFixed(3);
    if (ui.selUnitCo2 && ui.selUnitCo2.value !== fuelCo2Unit) ui.selUnitCo2.value = fuelCo2Unit;
    
    if (document.activeElement !== ui.inpFuelEff) ui.inpFuelEff.value = state.boilerEff.toFixed(2);
    
    if (ui.selPerfection) {
        const perfStr = perfectionDegree.toFixed(2);
        const isCustom = ui.selPerfection.value === 'CUSTOM' || (!['0.40', '0.45', '0.55'].includes(perfStr));
        if (isCustom) {
            ui.selPerfection.value = 'CUSTOM';
            ui.boxPerfCustom.classList.remove('hidden');
            if (document.activeElement !== ui.inpPerfectionCustom) ui.inpPerfectionCustom.value = perfStr;
        } else {
            ui.selPerfection.value = perfStr;
            ui.boxPerfCustom.classList.add('hidden');
        }
    }
    
    ui.chkManualCop.checked = isManualCop;
    ui.inpManualCop.disabled = !isManualCop;
    if (document.activeElement !== ui.inpManualCop) ui.inpManualCop.value = manualCop;
    
    const isSteam = (mode === MODES.STEAM);
    ui.btnWater.className = !isSteam ? "flex-1 py-1.5 text-xs font-bold rounded-md shadow bg-white text-indigo-600 transition" : "flex-1 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-700 transition";
    ui.btnSteam.className = isSteam ? "flex-1 py-1.5 text-xs font-bold rounded-md shadow bg-white text-indigo-600 transition" : "flex-1 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-700 transition";

    if (topology === TOPOLOGY.RECOVERY) {
        ui.panelStd.classList.add('hidden');
        ui.panelRec.classList.remove('hidden');
        if (isSteam) {
             ui.boxTargetStd.classList.remove('hidden'); 
             ui.lblTarget.innerText = "系统饱和蒸汽压力 (Target)";
             ui.unitTarget.innerText = "MPa(a)";
             const altitude = store.getState().altitude || 0;
             const atmPressure = calculateAtmosphericPressure(altitude);
             ui.resSatTemp.innerText = `${getSatTempFromPressure(targetTemp, atmPressure)} °C`;
             ui.boxSteamInfo.classList.remove('hidden');
             ui.lblLoadIn.innerText = "锅炉补水温度 (In)";
             ui.lblLoadOut.innerText = "热泵预热目标温度 (HP Out)"; 
             ui.boxSteamStrat.classList.remove('hidden');
        } else {
             ui.boxTargetStd.classList.add('hidden'); 
             ui.lblLoadIn.innerText = "系统回水温度 (In)";
             ui.lblLoadOut.innerText = "系统总供水目标 (Target)"; 
             ui.boxSteamStrat.classList.add('hidden');
        }
    } else {
        ui.panelRec.classList.add('hidden');
        ui.panelStd.classList.remove('hidden');
        ui.boxTargetStd.classList.remove('hidden');
        ui.boxSteamStrat.classList.add('hidden');
        const labelSourceIn = document.getElementById('label-source-temp');
        if (topology === TOPOLOGY.PARALLEL) {
            if (labelSourceIn) labelSourceIn.innerText = "室外干球温度";
            ui.unitSourceIn.innerText = "°C";
            ui.boxSourceOut.classList.add('hidden');
        } 
        else if (topology === TOPOLOGY.COUPLED) {
            if (labelSourceIn) labelSourceIn.innerText = "余热源入口温度 (In)";
            ui.unitSourceIn.innerText = "°C";
            ui.boxSourceOut.classList.remove('hidden');
        }
        ui.boxLoadInStd.classList.remove('hidden'); 
        if (isSteam) {
            ui.lblTarget.innerText = "目标饱和蒸汽压力";
            ui.unitTarget.innerText = "MPa(a)";
            ui.boxSteamInfo.classList.remove('hidden');
            ui.resSatTemp.innerText = `${getSatTempFromPressure(targetTemp)} °C`;
            document.getElementById('label-load-in-std').innerText = "热汇入口温度 (补水)";
        } else {
            ui.lblTarget.innerText = "目标供水温度 (Out)";
            ui.unitTarget.innerText = "°C";
            ui.boxSteamInfo.classList.add('hidden');
            document.getElementById('label-load-in-std').innerText = "热汇入口温度 (回水)";
        }
    }
    
    const isTon = (loadUnit === 'TON');
    ui.selLoadUnit.value = loadUnit;
    ui.unitLoadDisplay.innerText = loadUnit;
    if (isTon) {
        ui.inpLoad.classList.add('hidden');
        ui.inpLoadTon.classList.remove('hidden');
        ui.infoLoadConv.classList.remove('hidden');
        if (document.activeElement !== ui.inpLoadTon) ui.inpLoadTon.value = loadValueTons;
        ui.valLoadConv.innerText = loadValue.toLocaleString(undefined, { maximumFractionDigits: 1 });
    } else {
        ui.inpLoad.classList.remove('hidden');
        ui.inpLoadTon.classList.add('hidden');
        ui.infoLoadConv.classList.add('hidden');
        if (document.activeElement !== ui.inpLoad) ui.inpLoad.value = loadValue;
    }
});

// === 5. 仿真运行逻辑 ===

// 辅助函数：生成决策信息（与System.js中的逻辑一致）
function makeDecision(annualSaving, payback) {
    const saveWan = annualSaving / 10000;
    let d = {
        winner: 'BASE',
        level: 'NEGATIVE',
        title: "🛑 不推荐 (Not Recommended)",
        desc: `当前工况下，热泵运行成本将高出 ${Math.abs(saveWan).toFixed(1)} 万元/年`,
        gainWan: saveWan,
        class: "bg-orange-50 border-orange-200 text-orange-800"
    };

    if (annualSaving > 0) {
        d.winner = 'HP';
        d.gainWan = saveWan;
        if (payback < 4.0) {
            d.level = 'STRONG';
            d.title = "🏆 强力推荐 (Highly Recommended)";
            d.desc = `相比对比燃料，每年产生纯收益 ${saveWan.toFixed(1)} 万元，预计 ${payback.toFixed(1)} 年回本。`; 
            d.class = "bg-emerald-50 border-emerald-200 text-emerald-800";
        } else {
            d.level = 'MARGINAL';
            d.title = "⚖️ 建议考虑 (Consider)";
            d.desc = `虽然每年节省 ${saveWan.toFixed(1)} 万元，但投资回收期较长 (${payback.toFixed(1)} 年)。`;
            d.class = "bg-blue-50 border-blue-200 text-blue-800";
        }
    }
    return d;
}

// 5.1 Python 呼叫专用函数
// src/ui/main.js

async function runPythonSchemeC(state) {
    // 🟢 [终极修复] 智能热值归一化
    // 无论用户选什么单位，我们根据数值大小猜它是 kWh 还是 MJ
    let normalizedCalValue = state.fuelCalValue;
    
    // 判定条件：
    // 1. 明确选了 kWh 单位
    const isUnitKWh = state.fuelCalUnit && state.fuelCalUnit.includes('kWh');
    // 2. 或者：选了天然气，且数值小于 20 (说明填的是 ~10 kWh，而不是 ~36 MJ)
    const isLowValue = (state.fuelType === 'NATURAL_GAS' && state.fuelCalValue < 20);

    if (isUnitKWh || isLowValue) {
        normalizedCalValue = state.fuelCalValue * 3.6;
        // 打印一条日志告诉用户发生了修正
        log(`⚠️ 检测到热值 (${state.fuelCalValue}) 为 kWh 量级，已自动修正为 ${normalizedCalValue.toFixed(1)} MJ`, 'warning');
    }

    // 2. 准备数据: 计算烟气量
    const boiler = new Boiler({
        fuelType: state.fuelType,
        efficiency: state.boilerEff,
        loadKW: state.loadValue, 
        flueIn: state.flueIn,
        flueOut: state.flueOut,
        excessAir: state.excessAir,
        fuelCalValue: normalizedCalValue, // <--- 传入修正后的值
        fuelCo2Value: state.fuelCo2Value
    });
    const sourcePot = boiler.calculateSourcePotential();
    
    // 2.1 计算烟气成分组成和质量流量
    let flueGasComposition = null;
    let flueGasMassFlow = 0;
    
    if (state.fuelType !== 'ELECTRICITY' && sourcePot.flowVol > 0) {
        // 计算烟气成分（体积百分比）
        const alpha = state.excessAir || 1.2;
        const fuelData = FUEL_DB[state.fuelType];
        
        if (fuelData) {
            // 简化模型：基于燃料类型和过量空气系数估算成分
            // 天然气典型成分（干基，alpha=1.2时）：
            // CO2: ~8-10%, H2O: ~18-20%, N2: ~70-72%, O2: ~2-4%
            let co2VolPercent, h2oVolPercent, n2VolPercent, o2VolPercent;
            
            if (state.fuelType === 'NATURAL_GAS') {
                // 天然气：CH4 + 2O2 -> CO2 + 2H2O
                // 理论：1 m3 CH4 -> 1 m3 CO2 + 2 m3 H2O + 7.52 m3 N2
                // 实际（alpha=1.2）：增加20%空气，O2增加
                const theoCO2 = 1.0;  // 相对值
                const theoH2O = 2.0;
                const theoN2 = 7.52;
                const excessO2 = (alpha - 1.0) * 2.0;  // 过量O2
                const excessN2 = (alpha - 1.0) * 7.52;  // 过量N2
                
                const totalVol = theoCO2 + theoH2O + theoN2 + excessO2 + excessN2;
                co2VolPercent = (theoCO2 / totalVol) * 100;
                h2oVolPercent = (theoH2O / totalVol) * 100;
                n2VolPercent = ((theoN2 + excessN2) / totalVol) * 100;
                o2VolPercent = (excessO2 / totalVol) * 100;
            } else if (state.fuelType === 'COAL') {
                // 煤：简化模型，典型值
                co2VolPercent = 12.0;
                h2oVolPercent = 8.0;
                n2VolPercent = 76.0;
                o2VolPercent = 4.0;
            } else if (state.fuelType === 'DIESEL') {
                // 柴油：简化模型
                co2VolPercent = 10.0;
                h2oVolPercent = 12.0;
                n2VolPercent = 74.0;
                o2VolPercent = 4.0;
            } else {
                // 其他燃料：默认值
                co2VolPercent = 10.0;
                h2oVolPercent = 10.0;
                n2VolPercent = 76.0;
                o2VolPercent = 4.0;
            }
            
            flueGasComposition = {
                co2: co2VolPercent.toFixed(1),
                h2o: h2oVolPercent.toFixed(1),
                n2: n2VolPercent.toFixed(1),
                o2: o2VolPercent.toFixed(1)
            };
            
            // 🔧 计算烟气质量流量（kg/h）
            // 体积流量 sourcePot.flowVol 是标准状态 (0°C, 101.325 kPa) 下的体积
            // 需要根据实际温度进行密度修正
            // 烟气密度：标准状态下约1.2-1.3 kg/m3，考虑温度修正
            // 简化：使用平均密度 1.25 kg/m3（在100-200°C范围内）
            const avgFlueTemp = (state.flueIn + state.flueOut) / 2;  // 使用初始排烟和目标排烟的平均温度
            const densityAtSTP = 1.293;  // 标准状态 (0°C, 101.325 kPa) 空气密度 kg/m3
            const tempCorrection = 273.15 / (avgFlueTemp + 273.15);  // 温度修正（理想气体状态方程）
            const flueGasDensity = densityAtSTP * tempCorrection * 1.05;  // 考虑CO2等重气体，约1.05倍
            // 🔧 质量流量 = 标准状态体积流量 × 实际工况密度
            flueGasMassFlow = sourcePot.flowVol * flueGasDensity;
        }
    }
    
    // 3. 准备数据: 计算水流量
    // 🔧 修复：对于蒸汽系统，如果用户输入的是蒸吨（TON），应该直接使用蒸吨数作为补水流量
    // 对于热水系统或KW单位，才使用热负荷和目标温差计算流量
    let flow_kg_h;
    if (state.mode === MODES.STEAM && state.loadUnit === 'TON' && state.loadValueTons > 0) {
        // 蒸汽系统：直接使用用户输入的蒸吨数作为补水流量（kg/h）
        flow_kg_h = state.loadValueTons * 1000;  // 1 蒸吨 = 1000 kg/h
        log(`📊 蒸汽系统：使用用户输入的补水流量 ${state.loadValueTons} t/h = ${flow_kg_h.toFixed(0)} kg/h`);
    } else {
        // 热水系统或KW单位：使用热负荷和目标温差计算流量
        const deltaT_Water = state.loadOut - state.loadIn; 
        if (deltaT_Water <= 0) throw new Error("水温差必须大于 0");
        flow_kg_h = (state.loadValue * 3600) / (4.187 * deltaT_Water);
        log(`📊 热水系统：基于热负荷和目标温差计算流量 ${flow_kg_h.toFixed(0)} kg/h`);
    }

    // 4. 组装 Payload
    const payload = {
        sink_in_temp: state.loadIn,
        sink_out_target: state.loadOut, 
        sink_flow_kg_h: flow_kg_h,      
        source_in_temp: state.flueIn,
        source_out_target: state.flueOut,  // 🔧 修复：传递用户输入的目标排烟温度
        source_flow_vol: sourcePot.flowVol, 
        efficiency: state.perfectionDegree,
        mode: state.mode,
        strategy: state.steamStrategy || STRATEGIES.PREHEAT,  // 🔧 新增：传递策略（吸收式热泵需要）
        fuel_type: state.fuelType,
        recovery_type: state.recoveryType,  // 🔧 新增：传递热泵类型
        // 🔧 新增：传递手动COP锁定参数
        is_manual_cop: state.isManualCop,
        manual_cop: state.manualCop,
        // 🔧 新增：传递过量空气系数（用于计算水分析出）
        excess_air: state.excessAir || 1.2,
        // 🔧 新增：传递海拔高度（用于计算实际大气压力）
        altitude: state.altitude || 0
    };
    
    log(`📡 呼叫 Python: 流量=${flow_kg_h.toFixed(0)}kg/h, 烟气=${sourcePot.flowVol.toFixed(0)}m3/h`);

    // 5. 调用 API
    const pyRes = await fetchSchemeC(payload);
    console.log("📥 Python 后端响应:", pyRes);

    // 6. 检查收敛状态
    if (pyRes.status !== 'converged') {
        console.warn("⚠️ 后端计算未收敛:", pyRes.reason || "未知原因");
        throw new Error(pyRes.reason || "计算未收敛 (热源不足以支撑该负荷)");
    }

    // 7. 结果适配
    // 🔧 修复：如果热源不足，使用实际能达到的负荷和出水温度
    const recoveredHeat = pyRes.target_load_kw;
    const actualLoadOut = pyRes.actual_sink_out || state.loadOut;  // 如果热源不足，使用实际出水温度
    const actualFlueOut = pyRes.required_source_out;  // 实际排烟温度
    
    // 🔧 新增：从后端获取水分析出数据（如果后端返回了）
    const waterCondensationFromBackend = pyRes.water_condensation || null;
    
    // 🔧 关键修复：无论后端是否返回，都使用实际排烟温度重新计算，确保水分析出量随实际排烟温度变化
    // 这样可以确保当目标排烟温度变化时，水分析出量能正确更新
    let finalWaterCondensation = null;
    if (state.fuelType !== 'ELECTRICITY') {
        // 使用实际排烟温度重新计算水分析出量
        const fuelData = FUEL_DB[state.fuelType];
        if (fuelData) {
            const alpha = state.excessAir || 1.2;
            const actualDewPoint = calculateAdjustedDewPoint(fuelData.dewPointRef, alpha);
            
            // 计算烟气中水蒸气体积百分比
            let h2oVolPercent = 0;
            if (state.fuelType === 'NATURAL_GAS') {
                const theoCO2 = 1.0;
                const theoH2O = 2.0;
                const theoN2 = 7.52;
                const excessO2 = (alpha - 1.0) * 2.0;
                const excessN2 = (alpha - 1.0) * 7.52;
                const totalVol = theoCO2 + theoH2O + theoN2 + excessO2 + excessN2;
                h2oVolPercent = (theoH2O / totalVol) * 100;
            } else if (state.fuelType === 'COAL') {
                h2oVolPercent = 8.0;
            } else if (state.fuelType === 'DIESEL') {
                h2oVolPercent = 12.0;
            } else {
                h2oVolPercent = 10.0;
            }
            
            // 使用实际排烟温度计算水分析出量
            finalWaterCondensation = calculateWaterCondensation(
                state.flueIn,
                actualFlueOut,  // 使用实际排烟温度，而不是用户输入的目标温度
                sourcePot.flowVol,
                h2oVolPercent,
                actualDewPoint
            );
        }
    }
    
    // 🔧 修复：如果启用手动COP锁定，使用手动COP值计算驱动能耗
    const copForCalculation = (state.isManualCop && state.manualCop > 0) 
        ? state.manualCop 
        : pyRes.final_cop;
    
    // 🔧 调试日志：输出COP使用情况
    if (state.isManualCop && state.manualCop > 0) {
        console.log(`🔒 手动COP锁定已启用: 使用手动COP值 ${state.manualCop.toFixed(2)} (后端返回: ${pyRes.final_cop.toFixed(2)})`);
    } else {
        console.log(`📊 使用计算COP值: ${pyRes.final_cop.toFixed(2)}`);
    }
    
    const driveEnergy = recoveredHeat / copForCalculation;
    
    // 如果热源不足，记录日志
    if (pyRes.is_source_limited) {
        const actualFlueOut = pyRes.required_source_out;
        const targetFlueOut = state.flueOut;
        log(`⚠️ 热源不足警告：按用户指定的排烟温度 ${targetFlueOut.toFixed(1)}°C 计算，实际负荷 ${recoveredHeat.toFixed(1)} kW 低于目标负荷`, 'warning');
        log(`   实际排烟温度: ${actualFlueOut.toFixed(1)}°C (用户指定: ${targetFlueOut.toFixed(1)}°C)`, 'warning');
        log(`   实际出水温度: ${actualLoadOut.toFixed(1)}°C (目标: ${state.loadOut.toFixed(1)}°C)`, 'warning');
    }
    
    const baseline = boiler.calculateBaseline(state.fuelPrice);
    // 经济计算用修正后的 MJ 值计算能量，再除以“归一化前”的单位值来算钱？
    // 不，算钱要和用户的输入保持一致。如果用户输入 10 kWh/m3, 单价 3.8 元/m3。
    // 我们算出节省了 X MJ 能量。
    // X MJ / 3.6 = Y kWh.
    // Y kWh / 10 (用户输入的10) = Z m3.
    // Z m3 * 3.8 = 钱。
    // 计算节省的燃料（用于经济性和CO2计算）
    // 热泵回收的热量 = recoveredHeat (kW)
    // 如果不用热泵，这部分热量需要由锅炉提供
    // 锅炉需要的燃料输入 = recoveredHeat / boilerEff
    // 节省的燃料 = (recoveredHeat / boilerEff) * 3.6 / normalizedCalValue
    const savedFuelInputKW = recoveredHeat / state.boilerEff;  // 节省的燃料输入功率 (kW)
    const savedFuelMJ = savedFuelInputKW * 3.6;  // 转换为 MJ
    const savedFuelUnit = savedFuelMJ / normalizedCalValue;  // 转换为燃料单位 (m3 或 kg)
    const savedCost = savedFuelUnit * state.fuelPrice;
    
    // 🔧 修复：根据热泵类型计算驱动成本
    let driveCost = 0;
    if (state.recoveryType === RECOVERY_TYPES.MVR) {
        // 电动热泵：驱动是电力
        driveCost = driveEnergy * state.elecPrice;
    } else {
        // 吸收式热泵：驱动是热（燃料）
        const driveInputFuelKW = driveEnergy / state.boilerEff;
        const driveInputMJ = driveInputFuelKW * 3.6;
        const driveFuelUnits = driveInputMJ / normalizedCalValue;
        driveCost = driveFuelUnits * state.fuelPrice;
    }
    
    const hourlySaving = savedCost - driveCost;
    const annualSaving = hourlySaving * state.annualHours;
    // 🔧 修复：回收期计算，当年节省额 <= 0 时显示特殊值
    const payback = (annualSaving > 0) ? ((recoveredHeat * state.capexHP) / annualSaving) : 99;

    // 🔧 修复：计算 CO2 减排率（改为直接计算方式，逻辑更清晰）
    // 基准系统（纯粹锅炉）：提供总负荷的CO2排放
    const baselineCo2PerHour = baseline.co2PerHour;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8d595749-f587-4ed5-9402-4cdd0306ec71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:843',message:'CO2计算开始',data:{baselineCo2PerHour,loadValue:state.loadValue,recoveredHeat},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // 耦合系统（锅炉+热泵）：直接计算实际CO2排放
    // 1. 计算锅炉实际需要提供的负荷
    const boilerLoadKW = state.loadValue - recoveredHeat;  // 锅炉实际负荷
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8d595749-f587-4ed5-9402-4cdd0306ec71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:850',message:'锅炉负荷计算',data:{boilerLoadKW,loadValue:state.loadValue,recoveredHeat,boilerEff:state.boilerEff},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    // 2. 计算锅炉实际CO2排放
    const boilerInputKW = boilerLoadKW / state.boilerEff;
    const boilerInputMJ = boilerInputKW * 3.6;
    const boilerFuelUnits = boilerInputMJ / normalizedCalValue;
    const boilerCo2 = boilerFuelUnits * boiler.fuelData.co2Factor;  // 锅炉CO2 (kg/h)
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8d595749-f587-4ed5-9402-4cdd0306ec71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:857',message:'锅炉CO2计算',data:{boilerInputKW,boilerInputMJ,boilerFuelUnits,boilerCo2,normalizedCalValue,co2Factor:boiler.fuelData.co2Factor},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    // 3. 计算热泵驱动能耗产生的CO2
    let driveCo2 = 0, drivePrimary = 0;
    if (state.recoveryType === RECOVERY_TYPES.MVR) {
        // 电动热泵：驱动是电力
        driveCo2 = driveEnergy * FUEL_DB['ELECTRICITY'].co2Factor;  // kg/h
        drivePrimary = driveEnergy * (state.pefElec || 2.5);
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8d595749-f587-4ed5-9402-4cdd0306ec71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:863',message:'电动热泵驱动CO2',data:{driveEnergy,driveCo2,elecCo2Factor:FUEL_DB['ELECTRICITY'].co2Factor,recoveryType:'MVR'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
    } else {
        // 吸收式热泵：驱动是热（燃料）
        const driveInputFuelKW = driveEnergy / state.boilerEff;
        const driveInputMJ = driveInputFuelKW * 3.6;
        const driveFuelUnits = driveInputMJ / normalizedCalValue;
        driveCo2 = driveFuelUnits * boiler.fuelData.co2Factor;  // kg/h
        drivePrimary = driveInputFuelKW * 1.05;
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8d595749-f587-4ed5-9402-4cdd0306ec71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:870',message:'吸收式热泵驱动CO2',data:{driveEnergy,driveInputFuelKW,driveInputMJ,driveFuelUnits,driveCo2,normalizedCalValue,co2Factor:boiler.fuelData.co2Factor,recoveryType:'ABSORPTION'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
    }
    
    // 4. 耦合系统总CO2 = 锅炉CO2 + 热泵驱动CO2
    const currentCo2 = boilerCo2 + driveCo2;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8d595749-f587-4ed5-9402-4cdd0306ec71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:876',message:'耦合系统CO2计算',data:{boilerCo2,driveCo2,currentCo2},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    
    // 5. 计算减排率 = (基准CO2 - 耦合CO2) / 基准CO2 * 100
    const co2Reduction = ((baselineCo2PerHour - currentCo2) / baselineCo2PerHour) * 100;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8d595749-f587-4ed5-9402-4cdd0306ec71',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:880',message:'减排率计算',data:{baselineCo2PerHour,currentCo2,co2Reduction,formula:`(${baselineCo2PerHour}-${currentCo2})/${baselineCo2PerHour}*100`},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    
    // 🔧 调试日志：输出CO2计算详情
    console.log("📊 CO2计算详情:", {
        "基准负荷(kW)": state.loadValue.toFixed(2),
        "基准CO2(kg/h)": baselineCo2PerHour.toFixed(2),
        "热泵回收热量(kW)": recoveredHeat.toFixed(2),
        "锅炉实际负荷(kW)": boilerLoadKW.toFixed(2),
        "锅炉CO2(kg/h)": boilerCo2.toFixed(2),
        "驱动能耗(kW)": driveEnergy.toFixed(2),
        "驱动CO2(kg/h)": driveCo2.toFixed(2),
        "耦合系统CO2(kg/h)": currentCo2.toFixed(2),
        "减排率(%)": co2Reduction.toFixed(2),
        "计算公式": `(${baselineCo2PerHour.toFixed(2)} - ${currentCo2.toFixed(2)}) / ${baselineCo2PerHour.toFixed(2)} * 100`
    });
    
    // 🔧 验证：检查计算是否合理
    if (co2Reduction < -10) {
        console.warn("⚠️ 警告：碳减排率为负且绝对值较大，请检查计算逻辑！");
        console.warn("   可能原因：驱动CO2 > 替代CO2，或计算有误");
    }
    
    // 🔧 修复：计算 PER
    const per = (drivePrimary > 0) ? (recoveredHeat / drivePrimary) : 0;
    
    // 🔧 修复：计算耦合数据（Site Eff 和 PER）
    const totalLoad = state.loadValue;
    const boilerOutput = totalLoad - recoveredHeat;
    const boilerInputFuel = boilerOutput / state.boilerEff;
    
    let siteInputTotal, primaryInputTotal;
    const pefFuel = 1.05;
    
    if (state.recoveryType === RECOVERY_TYPES.MVR) {
        siteInputTotal = boilerInputFuel + driveEnergy;
        primaryInputTotal = (boilerInputFuel * pefFuel) + (driveEnergy * (state.pefElec || 2.5));
    } else {
        const hpInputFuel = (driveEnergy / state.boilerEff);
        siteInputTotal = boilerInputFuel + hpInputFuel;
        primaryInputTotal = (boilerInputFuel + hpInputFuel) * pefFuel;
    }
    
    const siteEffBefore = state.boilerEff;
    const siteEffAfter = totalLoad / siteInputTotal;
    const perBefore = state.boilerEff / pefFuel;
    const perAfter = totalLoad / primaryInputTotal;
    
    const couplingData = {
        site: {
            before: siteEffBefore * 100,
            after: siteEffAfter * 100,
            delta: (siteEffAfter - siteEffBefore) * 100
        },
        per: {
            before: perBefore,
            after: perAfter,
            delta: perAfter - perBefore
        }
    };
    
    // 🔧 修复：计算 tonData
    const tonData = {
        total: state.loadValue / 700,
        hp: recoveredHeat / 700,
        boiler: (state.loadValue - recoveredHeat) / 700
    };
    
    // 🔧 修复：如果启用手动COP锁定，确保使用手动COP值（即使后端返回了计算值）
    // 这是一个双重保险，确保前端显示与用户设置一致
    const finalCop = (state.isManualCop && state.manualCop > 0) 
        ? state.manualCop 
        : pyRes.final_cop;
    
    const res = {
        cop: finalCop,  // 🔧 修复：使用手动COP或后端返回的COP
        lift: (state.loadOut + 5) - (pyRes.required_source_out - 5),
        recoveredHeat: recoveredHeat,
        annualSaving: annualSaving,
        costPerHour: baseline.costPerHour - hourlySaving,
        payback: payback,
        
        reqData: {
            sourceType: `烟气 (Flue Gas) @ ${state.flueIn}°C`,
            loadType: state.mode === MODES.STEAM ? "补水预热 (Pre-heat)" : "热水 (Hot Water)",
            sourceIn: state.flueIn,
            sourceOut: pyRes.required_source_out,
            loadIn: state.loadIn, 
            loadOut: actualLoadOut,  // 使用实际出水温度
            capacity: recoveredHeat,
            // 🔧 新增：热源参数
            sourceFlowVol: sourcePot.flowVol,  // 热源体积流量 (m3/h)
            sourceFlowMass: flueGasMassFlow,  // 热源质量流量 (kg/h)
            sourceComposition: flueGasComposition,  // 热源成分组成
            // 🔧 新增：热汇参数
            sinkFlowMass: flow_kg_h,  // 热汇质量流量 (kg/h)
            // 🔧 新增：水分析出数据（优先使用后端返回的数据，如果没有则使用实际排烟温度重新计算）
            waterCondensation: finalWaterCondensation ? {
                condensedWater: finalWaterCondensation.condensedWater,
                initialWater: finalWaterCondensation.initialWater,
                finalWater: finalWaterCondensation.finalWater
            } : null
        },
        
        co2ReductionRate: co2Reduction,  // 🔧 修复：使用计算值
        per: per,  // 🔧 修复：使用计算值
        couplingData: couplingData,  // 🔧 修复：使用计算值
        tonData: tonData,  // 🔧 修复：添加 tonData
        decision: makeDecision(annualSaving, payback)  // 🔧 修复：使用正确的决策逻辑
    };
    
    handleSimulationResult(res, state);
    log(`✅ Python 求解成功: 排烟 ${pyRes.required_source_out.toFixed(1)}°C`, 'eco');
}

// 5.2 [智能双模] 仿真主入口
async function runSimulation() {
    const state = store.getState();
    log(`🚀 仿真启动... [${state.topology}]`);
    
    if (ui.lblCop) ui.lblCop.innerText = "热泵机组 COP";
    ui.resCop.innerText = "..."; 

    // 本地估算函数 (Fallback)
    const runLocalFallback = (reason) => {
        log(`⚠️ ${reason} -> 切换至 JS 估算模式`, 'warning');
        const sys = new System(state);
        const res = sys.simulate();
        res.limitReason = res.limitReason || { type: 'SOURCE', text: '🔥 Source Limited (热源不足)' };
        handleSimulationResult(res, state);
    };

    if (state.topology === TOPOLOGY.RECOVERY) {
        try {
            await runPythonSchemeC(state);
        } catch (err) {
            const errorMsg = err.message || "";
            // 智能降级: 如果是热源不足导致的无法收敛，切回 JS 模式
            if (errorMsg.includes("无法收敛") || errorMsg.includes("热源不足") || errorMsg.includes("Failed")) {
                runLocalFallback("热源不足以支撑全额预热目标");
            } else {
                log(`❌ 系统错误: ${errorMsg}`, 'error');
                ui.resCop.innerText = "Err";
            }
        }
    } else {
        // 标准模式直接用 JS
        const sys = new System(state);
        const res = sys.simulate();
        handleSimulationResult(res, state);
    }
}

// 5.3 通用结果处理与 UI 渲染
function handleSimulationResult(res, state) {
    // 1. 错误处理
    if (res.error) {
        log(`❌ 错误: ${res.error}`, 'error');
        ui.resCop.innerText = "Err";
        return;
    }

    // 2. 基础数据更新
    currentReqData = res.reqData;

    // 🔧 修复：显示实际COP，但计算并提示目标COP（用于对比）
    let copTooltip = '';
    
    if (state.topology === TOPOLOGY.RECOVERY && res.reqData) {
        const actualFlueOut = res.reqData.sourceOut;
        const targetFlueOut = state.flueOut;
        
        // 如果实际排烟温度与目标不同，计算目标温度下的理论COP用于对比
        if (Math.abs(actualFlueOut - targetFlueOut) > 1.0) {
            // 计算目标温度下的理论COP
            let simulationTargetTemp;
            if (state.mode === MODES.STEAM) {
                const altitude = state.altitude || 0;
                const atmPressure = calculateAtmosphericPressure(altitude);
                simulationTargetTemp = getSatTempFromPressure(state.targetTemp, atmPressure);
                if (state.steamStrategy === STRATEGIES.PREHEAT && simulationTargetTemp > 98.0) {
                    simulationTargetTemp = 98.0;
                }
            } else {
                simulationTargetTemp = state.loadOut;
            }
            
            // 🔧 修复：如果启用手动COP锁定，使用手动COP值
            let targetCopRes;
            if (state.isManualCop && state.manualCop > 0) {
                targetCopRes = { cop: state.manualCop, error: null };
            } else {
                const tCond = simulationTargetTemp + 5.0;
                const tEvap = targetFlueOut - 5.0;
                
                targetCopRes = calculateCOP({
                    evapTemp: tEvap,
                    condTemp: Math.min(tCond, 160.0),
                    efficiency: state.perfectionDegree,
                    mode: state.mode,
                    strategy: state.steamStrategy,
                    recoveryType: state.recoveryType
                });
            }
            
            if (!targetCopRes.error) {
                copTooltip = `实际运行: COP=${res.cop.toFixed(2)} @ 排烟${actualFlueOut.toFixed(1)}°C (热源不足)\n目标理论: COP=${targetCopRes.cop.toFixed(2)} @ 排烟${targetFlueOut.toFixed(1)}°C`;
                console.log(`📊 COP对比: 实际=${res.cop.toFixed(2)} @ ${actualFlueOut.toFixed(1)}°C, 目标理论=${targetCopRes.cop.toFixed(2)} @ ${targetFlueOut.toFixed(1)}°C`);
            }
        }
    }
    
    // 显示实际COP（这是系统真实运行条件下的COP）
    ui.resCop.innerText = res.cop.toFixed(2);
    if (copTooltip) {
        ui.resCop.title = copTooltip;
        ui.resCop.style.cursor = 'help';
    }
    ui.resLift.innerText = (res.lift || 0).toFixed(1);

    // 3. 耦合效能更新
    if (res.couplingData && res.couplingData.site) {
        renderCouplingDashboard(res.couplingData);
    } else {
         if (res.per !== undefined && typeof renderStandardPER === 'function') {
             renderStandardPER(res.per.toFixed(2));
         }
    }

    // 4. 经济性分析更新
    if (res.annualSaving !== undefined) {
        ui.resCost.innerText = res.costPerHour.toFixed(1);
        
        // 更新单位成本
        const unitCost = res.costPerHour / state.loadValue;
        if (ui.resUnitCost) ui.resUnitCost.innerText = unitCost.toFixed(3);

        const annualSaveWan = res.annualSaving / 10000;
        if (ui.resAnnualSave) ui.resAnnualSave.innerText = `${annualSaveWan.toFixed(1)} 万`;
        
        if (res.decision) renderDecisionBanner(res.decision);
        
        // 🔧 修复：回收期显示逻辑，处理负值和超大值
        if (ui.resPayback) {
            if (res.payback >= 99 || res.payback < 0) {
                ui.resPayback.innerText = "N/A";
            } else if (res.payback > 20) {
                ui.resPayback.innerText = ">20";
            } else {
                ui.resPayback.innerText = res.payback.toFixed(1);
            }
        }
        // 🔧 修复：显示碳减排率，并添加tooltip显示计算过程
        if (ui.resCo2Red) {
            const co2Red = res.co2ReductionRate;
            ui.resCo2Red.innerText = co2Red.toFixed(1);
            
            // 🔧 调试：构建tooltip显示碳排放值详情
            let tooltipText = `碳减排率: ${co2Red.toFixed(2)}%\n\n`;
            
            // 方案A/B：显示对比能源和热泵碳排放值
            if (res.baselineCo2 !== undefined && res.hpSystemCo2 !== undefined) {
                tooltipText += `对比能源碳排放: ${res.baselineCo2.toFixed(2)} kg/h\n`;
                tooltipText += `热泵系统碳排放: ${res.hpSystemCo2.toFixed(2)} kg/h\n`;
                tooltipText += `计算公式: (${res.baselineCo2.toFixed(2)} - ${res.hpSystemCo2.toFixed(2)}) / ${res.baselineCo2.toFixed(2)} × 100%`;
            }
            // 方案C：显示对比能源和耦合系统碳排放值
            else if (res.baselineCo2 !== undefined && res.currentCo2 !== undefined) {
                tooltipText += `对比能源碳排放: ${res.baselineCo2.toFixed(2)} kg/h\n`;
                tooltipText += `耦合系统碳排放: ${res.currentCo2.toFixed(2)} kg/h\n`;
                tooltipText += `计算公式: (${res.baselineCo2.toFixed(2)} - ${res.currentCo2.toFixed(2)}) / ${res.baselineCo2.toFixed(2)} × 100%`;
            }
            
            // 如果值为负或异常，添加警告
            if (co2Red < -10 || Math.abs(co2Red) > 200) {
                tooltipText += `\n\n⚠️ 警告：如果为负值，说明热泵/耦合系统CO2高于基准CO2\n请检查对比燃料类型和CO2因子设置`;
                ui.resCo2Red.style.cursor = 'help';
            } else {
                ui.resCo2Red.style.cursor = 'default';
            }
            
            ui.resCo2Red.title = tooltipText;
        }
    }

    // 5. 系统产能更新
    if (res.recoveredHeat) {
        const totalCap = state.loadValue; 
        ui.valCapTotal.innerText = totalCap.toFixed(2);
        
        if (res.tonData) {
            ui.valCapTon.innerText = res.tonData.total.toFixed(3);
            
            let badgeHtml = '';
            if (res.limitReason) {
                const colorClass = res.limitReason.type === 'SOURCE' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700';
                badgeHtml = `<span class="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold ${colorClass} border border-transparent shadow-sm">${res.limitReason.text}</span>`;
            }

            ui.valCapBreakdown.innerHTML = `
                <div class="flex flex-col gap-1 w-full">
                    <div class="flex items-center justify-between text-[10px] sm:text-xs">
                        <div class="flex items-center gap-1">
                            <span class="w-2 h-2 rounded-full bg-slate-300"></span>
                            <span class="text-slate-500 font-medium">🔥 Aux.Blr: <b class="text-slate-700">${res.tonData.boiler.toFixed(3)}</b></span>
                        </div>
                        <div class="flex items-center gap-1">
                            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <span class="text-emerald-600 font-medium">HP: <b class="text-emerald-700">${res.tonData.hp.toFixed(3)}</b> t/h</span>
                        </div>
                    </div>
                    ${badgeHtml ? `<div class="text-center">${badgeHtml}</div>` : ''}
                </div>`;
        } else {
            ui.valCapBreakdown.innerHTML = '';
        }
    }

    // 6. 图表更新 - 🔧 修复：传递实际计算结果，用于标记实际运行点
    console.log("🔄 准备更新图表，当前状态:", state);
    updatePerformanceChart(state, res);

    // 7. 系统图更新
    let displaySupplyT;
    let displaySourceOut = state.flueOut; 

    if (state.topology === TOPOLOGY.RECOVERY && res.reqData) {
        displaySupplyT = res.reqData.loadOut;
        if (res.reqData.sourceOut) displaySourceOut = res.reqData.sourceOut;
    } else {
        displaySupplyT = (state.mode === MODES.STEAM) 
            ? (() => {
                const altitude = state.altitude || 0;
                const atmPressure = calculateAtmosphericPressure(altitude);
                return getSatTempFromPressure(state.targetTemp, atmPressure);
              })() 
            : state.targetTemp;
        displaySourceOut = state.sourceOut;
    }

    renderSystemDiagram('diagram-container', {
        topology: state.topology,
        tSource: state.sourceTemp,
        tDisplaySource: state.topology === TOPOLOGY.RECOVERY ? state.flueIn : state.sourceTemp,
        tDisplaySourceOut: displaySourceOut, 
        tSupply: displaySupplyT,
        recoveredKW: res.recoveredHeat || 0
    });

    // 8. 调试模式：直接在界面显示选型参数
    renderTechSpecDirectly(res.reqData);
}

function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('en-GB');
    let clr = 'text-green-400';
    if (type === 'error') clr = 'text-red-400';
    else if (type === 'warning') clr = 'text-amber-400'; // 增加 warning 颜色
    
    ui.log.innerHTML += `<div class="${clr} border-l-2 border-transparent pl-1"><span class="opacity-50">[${time}]</span> ${msg}</div>`;
    ui.log.scrollTop = ui.log.scrollHeight;
}

bindEvents();

const initialState = store.getState();
// 🔧 修复：从HTML读取所有输入框的初始值，确保与用户界面一致
const initialAdvancedState = {
    // 基本温度参数（从HTML读取）
    flueIn: parseFloat(ui.inpFlueIn?.value) || initialState.flueIn,
    flueOut: parseFloat(ui.inpFlueOut?.value) || initialState.flueOut,
    loadIn: parseFloat(ui.inpLoadIn?.value) || initialState.loadIn,
    loadOut: parseFloat(ui.inpLoadOut?.value) || initialState.loadOut,
    sourceTemp: parseFloat(ui.inpSource?.value) || initialState.sourceTemp,
    sourceOut: parseFloat(ui.inpSourceOut?.value) || initialState.sourceOut,
    loadInStd: parseFloat(ui.inpLoadInStd?.value) || initialState.loadInStd,
    targetTemp: parseFloat(ui.inpTarget?.value) || initialState.targetTemp,
    excessAir: parseFloat(ui.inpExcessAir?.value) || initialState.excessAir,
    
    // 高级参数
    fuelCalValue: parseFloat(ui.inpFuelCal?.value) || 10.0,
    fuelCalUnit: CAL_UNIT_OPTIONS[0].value, 
    fuelCo2Value: parseFloat(ui.inpFuelCo2?.value) || 0.202,
    fuelCo2Unit: CO2_UNIT_OPTIONS[0].value, 
    perfectionDegree: parseFloat(ui.selPerfection?.value) || 0.45,
    boilerEff: parseFloat(ui.inpFuelEff?.value) || 0.92,
    manualCop: parseFloat(ui.inpManualCop?.value) || 3.5,
    isManualCop: ui.chkManualCop?.checked || false,
    elecPrice: parseFloat(ui.inpElecPrice?.value) || 0.75,
    fuelPrice: parseFloat(ui.inpFuelPrice?.value) || 3.80,
    capexHP: parseFloat(ui.inpCapexHP?.value) || 2500,
    capexBase: parseFloat(ui.inpCapexBase?.value) || 200
};

populateUnitSelect(ui.selUnitCal, CAL_UNIT_OPTIONS, initialAdvancedState.fuelCalUnit);
populateUnitSelect(ui.selUnitCo2, CO2_UNIT_OPTIONS, initialAdvancedState.fuelCo2Unit);

store.setState(initialAdvancedState);

if (initialState.loadUnit === 'KW' && initialState.loadValue && !initialState.loadValueTons) {
    const tons = initialState.loadValue / 700; 
    store.setState({ loadValueTons: tons });
}

if (ui.selRecType) store.setState({ recoveryType: ui.selRecType.value });
if (ui.selFuel) {
    store.setState({ fuelType: ui.selFuel.value });
    updatePriceInterlock(ui.selFuel.value);
}

store.notify(store.getState());