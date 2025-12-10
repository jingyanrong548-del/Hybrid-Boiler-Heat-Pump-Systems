// src/ui/main.js
import '../style.css'; 
import { store } from '../state/store.js';
import { System } from '../models/System.js';
import { updatePerformanceChart } from './charts.js';
import { renderSystemDiagram } from './diagram.js'; 
import { MODES, TOPOLOGY, STRATEGIES } from '../core/constants.js';
import { getSatTempFromPressure, convertSteamTonsToKW } from '../core/physics.js';

// === Unit Options for Advanced Parameters ===
const CAL_UNIT_OPTIONS = [
    { value: 'MJ/kg', text: 'MJ/kg', factor: 1.0 },
    { value: 'kWh/kg', text: 'kWh/kg', factor: 0.277778 }, 
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
    
    panelStd: document.getElementById('panel-input-standard'),
    panelRec: document.getElementById('panel-input-recovery'),
    boxTargetStd: document.getElementById('box-target-std'),
    boxSteamStrat: document.getElementById('box-steam-strategy'),
    
    // 方案 A/B 热源输入
    inpSource: document.getElementById('input-temp-source'),
    inpSourceOut: document.getElementById('input-temp-source-out'), 
    boxSourceOut: document.getElementById('box-source-out'), 
    unitSourceIn: document.getElementById('unit-source-in'), 
    
    // 方案 C 烟气输入
    inpFlueIn: document.getElementById('input-flue-temp-in'),
    inpFlueOut: document.getElementById('input-flue-temp-out'),
    
    // 方案 C 热汇输入
    inpLoadIn: document.getElementById('input-load-in'),
    inpLoadOut: document.getElementById('input-load-out'),
    lblLoadIn: document.getElementById('label-load-in'),
    lblLoadOut: document.getElementById('label-load-out'),
    
    // 方案 A/B 热汇输入
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

    resCop: document.getElementById('res-cop'),
    resLift: document.getElementById('res-lift'),
    resPer: document.getElementById('res-per'),
    resCo2Red: document.getElementById('res-co2-red'),
    
    resCost: document.getElementById('res-cost'),         
    resUnitCost: document.getElementById('res-unit-cost'), 
    resAnnualSave: document.getElementById('res-annual-save'), 
    
    valCapTotal: document.getElementById('val-cap-total'),
    valCapTon: document.getElementById('val-cap-ton'),
    valCapBreakdown: document.getElementById('val-cap-breakdown'),
    
    // 选型单 DOM
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

// === 2. 事件绑定 ===
function bindEvents() {
    ui.topo.addEventListener('change', (e) => {
        const newTopo = e.target.value;
        const updates = { topology: newTopo };
        // 切换拓扑时，给予合理的默认值，但不强制覆盖用户可能已输入的高级参数
        if (newTopo === TOPOLOGY.PARALLEL) updates.sourceTemp = -5.0; 
        else if (newTopo === TOPOLOGY.COUPLED) updates.sourceTemp = 35.0; 
        store.setState(updates);
    });

    // [修正] 模式切换逻辑：只改变模式和核心默认温度，避免全量重置
    ui.btnWater.addEventListener('click', () => {
        store.setState({ 
            mode: MODES.WATER, 
            targetTemp: 60.0, // 默认热水目标
            // 只有当这些值明显不合理（例如是蒸汽的高温）时才重置
            // 这里为了用户体验，我们提供一套标准热水工况默认值
            loadIn: 50.0, 
            loadOut: 70.0, 
            loadInStd: 50.0 
        });
    });

    ui.btnSteam.addEventListener('click', () => {
        store.setState({ 
            mode: MODES.STEAM, 
            targetTemp: 0.5, // 0.5 MPa
            loadIn: 20.0,    // 补水通常较冷
            loadOut: 90.0,   // 预热目标
            loadInStd: 20.0
        });
    });

    const bindInput = (el, key, isFloat = true) => {
        if(!el) return;
        el.addEventListener('input', (e) => {
            const val = isFloat ? parseFloat(e.target.value) : e.target.value;
            store.setState({ [key]: val });
        });
    };

    // 核心输入绑定
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
    
    // 高级参数绑定
    bindInput(ui.inpFuelCal, 'fuelCalValue');
    bindInput(ui.inpFuelCo2, 'fuelCo2Value');
    bindInput(ui.inpFuelEff, 'boilerEff');
    bindInput(ui.inpPefElec, 'pefElec');
    bindInput(ui.inpPerfectionCustom, 'perfectionDegree');
    
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
            
            store.setState({ 
                fuelCalValue: s.fuelCalValue * ratio, 
                fuelCalUnit: newUnit 
            });
        });
    }
    
    if (ui.selUnitCo2) {
        ui.selUnitCo2.addEventListener('change', (e) => {
            store.setState({ fuelCo2Unit: e.target.value });
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

    if (ui.selLoadUnit) {
        ui.selLoadUnit.addEventListener('change', (e) => {
            store.setState({ loadUnit: e.target.value });
        });
    }

    if (ui.inpLoadTon) {
        ui.inpLoadTon.addEventListener('input', (e) => {
            const tons = parseFloat(e.target.value) || 0;
            const kw = convertSteamTonsToKW(tons);
            store.setState({ loadValue: kw, loadValueTons: tons }); 
        });
    }

    if (ui.btnCalc) {
        ui.btnCalc.addEventListener('click', () => {
            runSimulation();
        });
    }

    // 选型单
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

    if (ui.btnCloseModal) {
        ui.btnCloseModal.addEventListener('click', () => {
            ui.modalReq.classList.add('hidden');
        });
    }

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

// === 3. 界面渲染 ===
store.subscribe((state) => {
    const { 
        topology, mode, targetTemp, sourceTemp, sourceOut, loadInStd, recoveryType, loadUnit, loadValue, loadValueTons, 
        fuelCalValue, fuelCalUnit, fuelCo2Value, fuelCo2Unit, perfectionDegree, isManualCop, manualCop 
    } = state;

    if (ui.topo.value !== topology) ui.topo.value = topology;
    if (ui.selRecType && ui.selRecType.value !== recoveryType) ui.selRecType.value = recoveryType;

    // 核心输入
    if (document.activeElement !== ui.inpTarget) ui.inpTarget.value = targetTemp;
    if (document.activeElement !== ui.inpLoadInStd) ui.inpLoadInStd.value = loadInStd;
    if (document.activeElement !== ui.inpSource) ui.inpSource.value = sourceTemp;
    if (document.activeElement !== ui.inpSourceOut) ui.inpSourceOut.value = sourceOut;
    if (document.activeElement !== ui.inpLoadIn) ui.inpLoadIn.value = state.loadIn;
    if (document.activeElement !== ui.inpLoadOut) ui.inpLoadOut.value = state.loadOut;

    if (ui.inpExcessAir && document.activeElement !== ui.inpExcessAir) {
        ui.inpExcessAir.value = state.excessAir;
    }
    
    // 高级参数
    if (document.activeElement !== ui.inpFuelCal) ui.inpFuelCal.value = fuelCalValue.toFixed(2);
    populateUnitSelect(ui.selUnitCal, CAL_UNIT_OPTIONS, fuelCalUnit);
    
    if (document.activeElement !== ui.inpFuelCo2) ui.inpFuelCo2.value = fuelCo2Value.toFixed(3);
    populateUnitSelect(ui.selUnitCo2, CO2_UNIT_OPTIONS, fuelCo2Unit);
    
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
    
    // 模式切换样式
    const isSteam = (mode === MODES.STEAM);
    ui.btnWater.className = !isSteam ? "flex-1 py-1.5 text-xs font-bold rounded-md shadow bg-white text-indigo-600 transition" : "flex-1 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-700 transition";
    ui.btnSteam.className = isSteam ? "flex-1 py-1.5 text-xs font-bold rounded-md shadow bg-white text-indigo-600 transition" : "flex-1 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-700 transition";

    // --- 动态输入面板切换逻辑 (State-Driven Logic) ---
    if (topology === TOPOLOGY.RECOVERY) {
        // 方案 C
        ui.panelStd.classList.add('hidden');
        ui.panelRec.classList.remove('hidden');
        
        if (isSteam) {
             // 蒸汽模式：显示目标压力
             ui.boxTargetStd.classList.remove('hidden'); 
             ui.lblTarget.innerText = "系统饱和蒸汽压力 (Target)";
             ui.unitTarget.innerText = "MPa(a)";
             ui.resSatTemp.innerText = `${getSatTempFromPressure(targetTemp)} °C`;
             ui.boxSteamInfo.classList.remove('hidden');
             
             ui.lblLoadIn.innerText = "锅炉补水温度 (In)";
             ui.lblLoadOut.innerText = "热泵预热目标温度 (HP Out)"; 
             ui.boxSteamStrat.classList.remove('hidden');
        } else {
             // 热水模式：隐藏目标压力，LoadOut 即为目标
             ui.boxTargetStd.classList.add('hidden'); 
             
             ui.lblLoadIn.innerText = "系统回水温度 (In)";
             ui.lblLoadOut.innerText = "系统总供水目标 (Target)"; // 语义修正
             ui.boxSteamStrat.classList.add('hidden');
        }

    } else {
        // 方案 A/B
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
    
    // 负荷单位同步
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

// === 4. 仿真运行 ===
function runSimulation() {
    const state = store.getState();
    log(`🚀 仿真启动... [${state.topology}] [α=${state.excessAir}]`);

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
    
    if (res.per !== undefined) ui.resPer.innerText = res.per.toFixed(2);
    else ui.resPer.innerText = "--";

    if (res.annualSaving !== undefined) {
        ui.resCost.innerText = res.costPerHour.toFixed(1);
        const unitCost = res.costPerHour / state.loadValue;
        if (ui.resUnitCost) ui.resUnitCost.innerText = unitCost.toFixed(3);
        
        // [万元单位]
        const annualSaveWan = res.annualSaving / 10000;
        if (ui.resAnnualSave) {
            ui.resAnnualSave.innerText = `${annualSaveWan.toFixed(1)} 万`;
        }
        
        // [决策建议]
        if (res.recommendation) {
            log(res.recommendation, annualSaveWan > 0 ? 'eco' : 'error');
        }

        if (ui.resPayback) ui.resPayback.innerText = (res.payback > 20) ? ">20" : res.payback.toFixed(1);
        if (ui.resCo2Red) ui.resCo2Red.innerText = res.co2ReductionRate.toFixed(1);
    }

    if (res.recoveredHeat) {
        const totalCap = state.loadValue; 
        ui.valCapTotal.innerText = totalCap.toFixed(0);
        
        if (res.tonData) {
            ui.valCapTon.innerText = res.tonData.total.toFixed(1);
            ui.valCapBreakdown.innerHTML = `
                <div class="flex items-center gap-3 text-[10px] sm:text-xs">
                    <div class="flex items-center gap-1">
                        <span class="w-2 h-2 rounded-full bg-slate-300"></span>
                        <span class="text-slate-500 font-medium">Blr: <b class="text-slate-700">${res.tonData.boiler.toFixed(1)}</b></span>
                    </div>
                    <div class="flex items-center gap-1">
                        <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span class="text-emerald-600 font-medium">HP: <b class="text-emerald-700">${res.tonData.hp.toFixed(1)}</b> t/h</span>
                    </div>
                </div>`;
        } else {
            ui.valCapBreakdown.innerHTML = '';
        }
    }

    updatePerformanceChart(state);
    
    // 可视化参数准备
    let displaySupplyT;
    if (state.topology === TOPOLOGY.RECOVERY && res.reqData) {
        // 方案 C: 显示热泵实际出口温度
        displaySupplyT = res.reqData.loadOut; 
    } else {
        // 方案 A/B: 显示目标温度
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

// 初始化
bindEvents();

// 首次加载初始化 (Advanced Params)
const initialState = store.getState();
const initialAdvancedState = {
    fuelCalValue: parseFloat(ui.inpFuelCal.value) || 10.0,
    fuelCalUnit: CAL_UNIT_OPTIONS[0].value, 
    fuelCo2Value: parseFloat(ui.inpFuelCo2.value) || 0.202,
    fuelCo2Unit: CO2_UNIT_OPTIONS[0].value, 
    perfectionDegree: parseFloat(ui.selPerfection.value) || 0.45,
    boilerEff: parseFloat(ui.inpFuelEff.value) || 0.92,
    manualCop: parseFloat(ui.inpManualCop.value) || 3.5,
    isManualCop: ui.chkManualCop.checked || false
};
store.setState(initialAdvancedState);

// 首次计算 loadValueTons
if (initialState.loadUnit === 'KW' && initialState.loadValue && !initialState.loadValueTons) {
    const tons = initialState.loadValue / 700; 
    store.setState({ loadValueTons: tons });
}

if (ui.selRecType) store.setState({ recoveryType: ui.selRecType.value });
store.notify(store.getState());