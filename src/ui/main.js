// src/ui/main.js
import '../style.css'; 
import { store } from '../state/store.js';
import { System } from '../models/System.js';
import { updatePerformanceChart } from './charts.js';
import { renderSystemDiagram } from './diagram.js'; 
import { MODES, TOPOLOGY, STRATEGIES } from '../core/constants.js';
import { getSatTempFromPressure, convertSteamTonsToKW } from '../core/physics.js';

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
    
    inpSource: document.getElementById('input-temp-source'),
    inpFlueIn: document.getElementById('input-flue-temp-in'),
    inpFlueOut: document.getElementById('input-flue-temp-out'),
    inpLoadIn: document.getElementById('input-load-in'),
    inpLoadOut: document.getElementById('input-load-out'),
    selSteamStrat: document.getElementById('select-steam-strategy'),
    selRecType: document.getElementById('select-recovery-type'),
    inpPefElec: document.getElementById('inp-pef-elec'),
    
    // [v9.1 新增] 过量空气系数输入框
    inpExcessAir: document.getElementById('inp-excess-air'),

    inpTarget: document.getElementById('input-target-val'),
    lblTarget: document.getElementById('label-target-val'),
    unitTarget: document.getElementById('unit-target-val'),
    resSatTemp: document.getElementById('res-sat-temp'),
    boxSteamInfo: document.getElementById('steam-info-box'),

    inpLoad: document.getElementById('input-load'),
    inpLoadTon: document.getElementById('input-load-ton'),
    selLoadUnit: document.getElementById('select-load-unit'),
    valLoadConv: document.getElementById('val-load-converted'),
    infoLoadConv: document.getElementById('info-load-converted'),

    btnCalc: document.getElementById('btn-calculate'),

    resCop: document.getElementById('res-cop'),
    resLift: document.getElementById('res-lift'),
    resPer: document.getElementById('res-per'),
    resCo2Red: document.getElementById('res-co2-red'),
    
    resCost: document.getElementById('res-cost'),         
    resUnitCost: document.getElementById('res-unit-cost'), 
    resAnnualSave: document.getElementById('res-annual-save'), 
    resPayback: document.getElementById('res-payback'),   
    
    valCapTotal: document.getElementById('val-cap-total'),
    valCapTon: document.getElementById('val-cap-ton'),
    valCapBreakdown: document.getElementById('val-cap-breakdown'),
    
    // 选型单相关的 DOM 元素
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

// 暂存选型数据
let currentReqData = null;

// === 2. 事件绑定 ===
function bindEvents() {
    ui.topo.addEventListener('change', (e) => {
        const newTopo = e.target.value;
        const updates = { topology: newTopo };
        if (newTopo === TOPOLOGY.PARALLEL) updates.sourceTemp = -5.0;
        else if (newTopo === TOPOLOGY.COUPLED) updates.sourceTemp = 35.0;
        store.setState(updates);
    });

    ui.btnWater.addEventListener('click', () => {
        store.setState({ 
            mode: MODES.WATER, targetTemp: 60.0, loadIn: 50.0, loadOut: 70.0
        });
    });

    ui.btnSteam.addEventListener('click', () => {
        store.setState({ 
            mode: MODES.STEAM, targetTemp: 0.5, loadIn: 20.0, loadOut: 90.0
        });
    });

    const bindInput = (el, key, isFloat = true) => {
        if(!el) return;
        el.addEventListener('input', (e) => {
            const val = isFloat ? parseFloat(e.target.value) : e.target.value;
            store.setState({ [key]: val });
        });
    };

    bindInput(ui.inpSource, 'sourceTemp');
    bindInput(ui.inpFlueIn, 'flueIn');
    bindInput(ui.inpFlueOut, 'flueOut');
    bindInput(ui.inpLoadIn, 'loadIn');
    bindInput(ui.inpLoadOut, 'loadOut');
    bindInput(ui.inpTarget, 'targetTemp');
    bindInput(ui.inpLoad, 'loadValue');
    bindInput(ui.inpLoadTon, 'loadValueTons');
    bindInput(ui.inpPefElec, 'pefElec');
    
    // [v9.1 新增] 绑定过量空气系数
    bindInput(ui.inpExcessAir, 'excessAir');
    
    if(ui.selSteamStrat) ui.selSteamStrat.addEventListener('change', (e) => store.setState({ steamStrategy: e.target.value }));
    if(ui.selRecType) ui.selRecType.addEventListener('change', (e) => store.setState({ recoveryType: e.target.value }));

    ui.selLoadUnit.addEventListener('change', (e) => {
        const unit = e.target.value;
        store.setState({ loadUnit: unit });
        if(unit === 'TON') {
            ui.inpLoad.classList.add('hidden');
            ui.inpLoadTon.classList.remove('hidden');
            ui.infoLoadConv.classList.remove('hidden');
        } else {
            ui.inpLoad.classList.remove('hidden');
            ui.inpLoadTon.classList.add('hidden');
            ui.infoLoadConv.classList.add('hidden');
        }
    });

    ui.inpLoadTon.addEventListener('input', (e) => {
        const tons = parseFloat(e.target.value) || 0;
        const kw = convertSteamTonsToKW(tons);
        store.setState({ loadValue: kw });
        ui.valLoadConv.innerText = kw.toLocaleString();
    });

    ui.btnCalc.addEventListener('click', () => {
        runSimulation();
    });

    // 选型单按钮事件
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
            ui.reqCapacity.innerText = currentReqData.capacity.toLocaleString();
            
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
    const { topology, mode, targetTemp, sourceTemp, recoveryType } = state;

    if (ui.topo.value !== topology) ui.topo.value = topology;
    if (ui.selRecType && ui.selRecType.value !== recoveryType) ui.selRecType.value = recoveryType;

    if (document.activeElement !== ui.inpTarget) ui.inpTarget.value = targetTemp;
    if (document.activeElement !== ui.inpSource) ui.inpSource.value = sourceTemp;
    if (document.activeElement !== ui.inpLoadIn) ui.inpLoadIn.value = state.loadIn;
    if (document.activeElement !== ui.inpLoadOut) ui.inpLoadOut.value = state.loadOut;
    
    // [v9.1] 渲染过量空气系数
    if (ui.inpExcessAir && document.activeElement !== ui.inpExcessAir) {
        ui.inpExcessAir.value = state.excessAir;
    }

    const isSteam = (mode === MODES.STEAM);
    ui.btnWater.className = !isSteam ? "flex-1 py-1.5 text-xs font-bold rounded-md shadow bg-white text-indigo-600 transition" : "flex-1 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-700 transition";
    ui.btnSteam.className = isSteam ? "flex-1 py-1.5 text-xs font-bold rounded-md shadow bg-white text-indigo-600 transition" : "flex-1 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-700 transition";

    if (topology === TOPOLOGY.RECOVERY) {
        ui.panelStd.classList.add('hidden');
        ui.boxTargetStd.classList.add('hidden');
        ui.panelRec.classList.remove('hidden');
        if (isSteam) ui.boxSteamStrat.classList.remove('hidden');
        else ui.boxSteamStrat.classList.add('hidden');
    } else {
        ui.panelRec.classList.add('hidden');
        ui.panelStd.classList.remove('hidden');
        ui.boxTargetStd.classList.remove('hidden');
        ui.boxSteamStrat.classList.add('hidden');
        
        const label = document.getElementById('label-source-temp');
        if (label) label.innerText = (topology === TOPOLOGY.PARALLEL) ? "室外干球温度" : "余热源温度";
    }

    if (isSteam) {
        ui.lblTarget.innerText = "目标饱和蒸汽压力";
        ui.unitTarget.innerText = "MPa(a)";
        ui.boxSteamInfo.classList.remove('hidden');
        ui.resSatTemp.innerText = `${getSatTempFromPressure(targetTemp)} °C`;
    } else {
        ui.lblTarget.innerText = "目标供水/回水温度";
        ui.unitTarget.innerText = "°C";
        ui.boxSteamInfo.classList.add('hidden');
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
        if (ui.resAnnualSave) {
            ui.resAnnualSave.innerText = res.annualSaving > 10000 
                ? `${(res.annualSaving/10000).toFixed(1)}万` 
                : res.annualSaving.toFixed(0);
        }
        if (ui.resPayback) ui.resPayback.innerText = (res.payback > 20) ? ">20" : res.payback.toFixed(1);
        if (ui.resCo2Red) ui.resCo2Red.innerText = res.co2ReductionRate.toFixed(1);
    }

    if (res.recoveredHeat) {
        const totalCap = res.tonData ? (res.tonData.total * 700) : res.recoveredHeat;
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
    
    const displaySupplyT = (state.mode === MODES.STEAM) 
        ? getSatTempFromPressure(state.targetTemp) 
        : state.targetTemp;

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
if (ui.selRecType) store.setState({ recoveryType: ui.selRecType.value });
store.notify(store.getState());