// src/ui/main.js
import '../style.css'; 
import { store } from '../state/store.js';
import { System } from '../models/System.js';
import { Boiler } from '../models/Boiler.js'; // 用于计算烟气量
import { fetchSchemeC } from '../core/api.js'; // 用于呼叫 Python
import { updatePerformanceChart } from './charts.js';
import { renderSystemDiagram } from './diagram.js'; 
import { MODES, TOPOLOGY, STRATEGIES, FUEL_DB } from '../core/constants.js';
import { getSatTempFromPressure, convertSteamTonsToKW } from '../core/physics.js';

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

// === 辅助函数 ===
function resetFuelParams(fuelType) {
    const db = FUEL_DB[fuelType] || FUEL_DB['NATURAL_GAS'];
    let bestCalUnit = 'MJ/kg'; 
    if (db.unit === 'm³') bestCalUnit = 'MJ/m3';
    
    const updates = {
        fuelType: fuelType,
        fuelCalValue: db.calorificValue, 
        fuelCalUnit: bestCalUnit,
        fuelCo2Value: db.co2Factor,     
        fuelCo2Unit: 'kgCO2/unit',
        boilerEff: db.defaultEfficiency || (fuelType === 'ELECTRICITY' ? 0.99 : 0.92)
    };

    if (fuelType === 'ELECTRICITY') {
        const currentElecPrice = parseFloat(ui.inpElecPrice.value) || 0.75;
        updates.fuelPrice = currentElecPrice;
    }

    store.setState(updates);
    populateUnitSelect(ui.selUnitCal, CAL_UNIT_OPTIONS, bestCalUnit);
    populateUnitSelect(ui.selUnitCo2, CO2_UNIT_OPTIONS, 'kgCO2/unit');
    log(`🔄 燃料切换: ${db.name} (参数已重置)`, 'info');
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

            <div class="col-span-2 border-t border-slate-300 pt-1 mt-1 flex justify-between items-center">
                <span class="text-slate-500">制热量 (Capacity):</span>
                <span class="text-sm font-bold text-indigo-600">${reqData.capacity.toLocaleString(undefined, {maximumFractionDigits: 0})} kW</span>
            </div>
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
        const updates = { topology: newTopo };
        if (newTopo === TOPOLOGY.PARALLEL) updates.sourceTemp = -5.0; 
        else if (newTopo === TOPOLOGY.COUPLED) updates.sourceTemp = 35.0; 
        store.setState(updates);
    });

    ui.btnWater.addEventListener('click', () => {
        store.setState({ mode: MODES.WATER, targetTemp: 60.0, loadIn: 50.0, loadOut: 70.0, loadInStd: 50.0 });
    });

    ui.btnSteam.addEventListener('click', () => {
        store.setState({ mode: MODES.STEAM, targetTemp: 0.5, loadIn: 20.0, loadOut: 90.0, loadInStd: 20.0 });
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
    
    bindInput(ui.inpFuelCal, 'fuelCalValue');
    bindInput(ui.inpFuelCo2, 'fuelCo2Value');
    bindInput(ui.inpFuelEff, 'boilerEff');
    bindInput(ui.inpPefElec, 'pefElec');
    bindInput(ui.inpPerfectionCustom, 'perfectionDegree');
    bindInput(ui.inpCapexHP, 'capexHP');
    bindInput(ui.inpCapexBase, 'capexBase');
    
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
        });
    }
    
    if (ui.selUnitCo2) ui.selUnitCo2.addEventListener('change', (e) => store.setState({ fuelCo2Unit: e.target.value }));
    
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
        fuelType, elecPrice, fuelPrice
    } = state;

    if (ui.topo.value !== topology) ui.topo.value = topology;
    if (ui.selRecType && ui.selRecType.value !== recoveryType) ui.selRecType.value = recoveryType;
    if (ui.selFuel && ui.selFuel.value !== fuelType) ui.selFuel.value = fuelType;
    if (document.activeElement !== ui.inpElecPrice) ui.inpElecPrice.value = elecPrice;
    
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
             ui.resSatTemp.innerText = `${getSatTempFromPressure(targetTemp)} °C`;
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

// 5.1 Python 呼叫专用函数
async function runPythonSchemeC(state) {
    // 1. 准备数据: 计算烟气量
    const boiler = new Boiler({
        fuelType: state.fuelType,
        efficiency: state.boilerEff,
        loadKW: state.loadValue, 
        flueIn: state.flueIn,
        flueOut: state.flueOut,
        excessAir: state.excessAir,
        fuelCalValue: state.fuelCalValue,
        fuelCo2Value: state.fuelCo2Value
    });
    const sourcePot = boiler.calculateSourcePotential();
    
    // 2. 准备数据: 计算水流量
    const deltaT_Water = state.loadOut - state.loadIn; 
    if (deltaT_Water <= 0) throw new Error("水温差必须大于 0");
    const flow_kg_h = (state.loadValue * 3600) / (4.187 * deltaT_Water);

    // 3. 组装 Payload
    const payload = {
        sink_in_temp: state.loadIn,
        sink_out_target: state.loadOut, 
        sink_flow_kg_h: flow_kg_h,      
        source_in_temp: state.flueIn,
        source_flow_vol: sourcePot.flowVol, 
        efficiency: state.perfectionDegree,
        mode: state.mode,
        fuel_type: state.fuelType
    };
    
    log(`📡 呼叫 Python: 流量=${flow_kg_h.toFixed(0)}kg/h, 烟气=${sourcePot.flowVol.toFixed(0)}m3/h`);

    // 4. 调用 API
    const pyRes = await fetchSchemeC(payload);

    // 5. 检查收敛状态
    if (pyRes.status !== 'converged') {
        throw new Error(pyRes.reason || "计算未收敛 (热源不足以支撑该负荷)");
    }

    // 6. 结果适配 (Python物理结果 -> UI经济结果)
    const recoveredHeat = pyRes.target_load_kw;
    const driveEnergy = recoveredHeat / pyRes.final_cop;
    
    const baseline = boiler.calculateBaseline(state.fuelPrice);
    const savedFuelMJ = (recoveredHeat / state.boilerEff) * 3.6;
    const savedFuelUnit = savedFuelMJ / state.fuelCalValue;
    const savedCost = savedFuelUnit * state.fuelPrice;
    
    // 假设电驱动 MVR
    const driveCost = driveEnergy * state.elecPrice; 
    
    const hourlySaving = savedCost - driveCost;
    const annualSaving = hourlySaving * state.annualHours;
    const payback = (recoveredHeat * state.capexHP) / annualSaving;

    const res = {
        cop: pyRes.final_cop,
        lift: (state.loadOut + 5) - (pyRes.required_source_out - 5),
        recoveredHeat: recoveredHeat,
        annualSaving: annualSaving,
        costPerHour: baseline.costPerHour - hourlySaving,
        payback: payback,
        
        reqData: {
            sourceType: `烟气 (Flue Gas) @ ${state.flueIn}°C`, // 补全 Type 字段
            loadType: state.mode === MODES.STEAM ? "补水预热 (Pre-heat)" : "热水 (Hot Water)", // 补全 Type 字段
            sourceIn: state.flueIn,
            sourceOut: pyRes.required_source_out, // 🟢 Python 算出的排烟
            loadIn: state.loadIn, 
            loadOut: state.loadOut,
            capacity: recoveredHeat
        },
        
        co2ReductionRate: 0, 
        per: 0,
        couplingData: { site: {before:0, after:0, delta:0}, per: {before:0, after:0, delta:0} },
        decision: { winner: annualSaving>0?'HP':'BASE', level: 'STRONG', title: 'Python Analysis', desc: '基于后端 AI 求解器结果' }
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

    ui.resCop.innerText = res.cop.toFixed(2);
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
        
        if (ui.resPayback) ui.resPayback.innerText = (res.payback > 20) ? ">20" : res.payback.toFixed(1);
        if (ui.resCo2Red) ui.resCo2Red.innerText = res.co2ReductionRate.toFixed(1);
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

    // 6. 图表更新
    updatePerformanceChart(state);

    // 7. 系统图更新
    let displaySupplyT;
    let displaySourceOut = state.flueOut; 

    if (state.topology === TOPOLOGY.RECOVERY && res.reqData) {
        displaySupplyT = res.reqData.loadOut;
        if (res.reqData.sourceOut) displaySourceOut = res.reqData.sourceOut;
    } else {
        displaySupplyT = (state.mode === MODES.STEAM) 
            ? getSatTempFromPressure(state.targetTemp) 
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
const initialAdvancedState = {
    fuelCalValue: parseFloat(ui.inpFuelCal.value) || 10.0,
    fuelCalUnit: CAL_UNIT_OPTIONS[0].value, 
    fuelCo2Value: parseFloat(ui.inpFuelCo2.value) || 0.202,
    fuelCo2Unit: CO2_UNIT_OPTIONS[0].value, 
    perfectionDegree: parseFloat(ui.selPerfection.value) || 0.45,
    boilerEff: parseFloat(ui.inpFuelEff.value) || 0.92,
    manualCop: parseFloat(ui.inpManualCop.value) || 3.5,
    isManualCop: ui.chkManualCop.checked || false,
    elecPrice: parseFloat(ui.inpElecPrice.value) || 0.75,
    fuelPrice: parseFloat(ui.inpFuelPrice.value) || 3.80,
    capexHP: parseFloat(ui.inpCapexHP.value) || 2500,
    capexBase: parseFloat(ui.inpCapexBase.value) || 200
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