// src/ui/main.js
import '../style.css'; 
import { store } from '../state/store.js';
import { System } from '../models/System.js';
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

// [FIXED] 获取或建立稳定的效率卡片容器
function getEfficiencyCardContainer() {
    // 尝试通过 ID 获取
    let container = document.getElementById('efficiency-card-panel');
    
    // 如果没有 ID，说明是初次加载，尝试通过 ui.resPer 查找
    if (!container && ui.resPer) {
        // 找到包含 res-per 的最近的卡片容器 (bg-white ...)
        container = ui.resPer.closest('.bg-white.p-4');
        if (container) {
            // 赋予永久 ID
            container.id = 'efficiency-card-panel';
        }
    }
    return container;
}

// [FIXED] 渲染耦合效能仪表盘
function renderCouplingDashboard(couplingData) {
    const parent = getEfficiencyCardContainer();
    if (!parent) return; // 找不到容器，放弃渲染

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

// [FIXED] 恢复标准 PER 显示
function renderStandardPER(val) {
    const parent = getEfficiencyCardContainer();
    if (!parent) return;

    parent.innerHTML = `
        <div class="text-[10px] uppercase font-bold text-slate-400 tracking-wider" id="lbl-res-3">一次能源利用率 (PER)</div>
        <div class="text-2xl font-bold text-violet-700 mt-1" id="res-per">${val}</div>
        <div class="text-[10px] text-violet-500 font-medium" id="desc-res-3">Efficiency</div>
    `;
    
    // 重要：重新绑定 ui.resPer，防止下次找不到子元素时引用错误
    ui.resPer = document.getElementById('res-per');
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

    if (ui.btnGenReq) {
        ui.btnGenReq.addEventListener('click', () => {
            if (!currentReqData) {
                alert('请先运行仿真以生成数据');
                return;
            }
            ui.reqSourceType.innerText = currentReqData.sourceType;
            ui.reqSourceIn.innerText = currentReqData.sourceIn.toFixed(1);
            ui.reqSourceOut.innerText = currentReqData.sourceOut.toFixed(1);
            ui.reqLoadType.innerText = currentReqData.loadType;
            ui.reqLoadIn.innerText = currentReqData.loadIn.toFixed(1);
            ui.reqLoadOut.innerText = currentReqData.loadOut.toFixed(1);
            ui.reqCapacity.innerText = currentReqData.capacity.toLocaleString(undefined, { maximumFractionDigits: 0 });
            ui.modalReq.classList.remove('hidden');
        });
    }

    if (ui.btnCloseModal) ui.btnCloseModal.addEventListener('click', () => ui.modalReq.classList.add('hidden'));

    if (ui.btnCopyReq) {
        ui.btnCopyReq.addEventListener('click', () => {
            if (!currentReqData) return;
            const text = `【工业热泵选型参数】\n热源: ${currentReqData.sourceType}\n温度: ${currentReqData.sourceIn.toFixed(1)} -> ${currentReqData.sourceOut.toFixed(1)}°C\n负荷: ${currentReqData.loadType}\n温度: ${currentReqData.loadIn.toFixed(1)} -> ${currentReqData.loadOut.toFixed(1)}°C\n制热量: ${currentReqData.capacity.toFixed(0)} kW`;
            navigator.clipboard.writeText(text).then(() => {
                const originalText = ui.btnCopyReq.innerText;
                ui.btnCopyReq.innerText = "已复制!";
                setTimeout(() => ui.btnCopyReq.innerText = originalText, 2000);
            });
        });
    }
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

// === 5. 仿真运行 ===
function runSimulation() {
    const state = store.getState();
    log(`🚀 仿真启动... [${state.topology}] [Fuel=${state.fuelType}]`);

    if (ui.lblCop) ui.lblCop.innerText = "热泵机组 COP (HP COP)";

    const sys = new System(state);
    const res = sys.simulate();

    if (res.error) {
        log(`❌ 错误: ${res.error}`, 'error');
        ui.resCop.innerText = "Err";
        if(ui.btnGenReq) {
            ui.btnGenReq.disabled = true;
            ui.btnGenReq.classList.add('opacity-50', 'cursor-not-allowed');
        }
        return;
    }

    currentReqData = res.reqData;
    
    if(ui.btnGenReq) {
        ui.btnGenReq.disabled = false;
        ui.btnGenReq.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    ui.resCop.innerText = res.cop.toFixed(2);
    ui.resLift.innerText = (res.lift || 0).toFixed(1);
    
    if (res.couplingData) {
        renderCouplingDashboard(res.couplingData);
    } else {
        if (res.per !== undefined) renderStandardPER(res.per.toFixed(2));
    }

    if (res.annualSaving !== undefined) {
        ui.resCost.innerText = res.costPerHour.toFixed(1);
        const unitCost = res.costPerHour / state.loadValue;
        if (ui.resUnitCost) ui.resUnitCost.innerText = unitCost.toFixed(3);
        
        const annualSaveWan = res.annualSaving / 10000;
        if (ui.resAnnualSave) {
            ui.resAnnualSave.innerText = `${annualSaveWan.toFixed(1)} 万`;
        }
        
        if (res.decision) {
            renderDecisionBanner(res.decision);
            log(res.recommendation, res.decision.winner === 'HP' ? 'eco' : 'error');
        } else {
            if (res.recommendation) log(res.recommendation);
        }

        if (ui.resPayback) ui.resPayback.innerText = (res.payback > 20) ? ">20" : res.payback.toFixed(1);
        if (ui.resCo2Red) ui.resCo2Red.innerText = res.co2ReductionRate.toFixed(1);
    }

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

    updatePerformanceChart(state);
    
    let displaySupplyT;
    if (state.topology === TOPOLOGY.RECOVERY && res.reqData) {
        displaySupplyT = res.reqData.loadOut; 
    } else {
        displaySupplyT = (state.mode === MODES.STEAM) 
            ? getSatTempFromPressure(state.targetTemp) 
            : state.targetTemp;
    }

    renderSystemDiagram('diagram-container', {
        topology: state.topology,
        tSource: state.sourceTemp,
        tDisplaySource: state.topology === TOPOLOGY.RECOVERY ? state.flueIn : state.sourceTemp,
        tSupply: displaySupplyT,
        recoveredKW: res.recoveredHeat || 0
    });

    log(`✅ 计算完成. COP=${res.cop}`, 'eco');
}

function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('en-GB');
    let clr = 'text-green-400';
    if (type === 'error') clr = 'text-red-400';
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