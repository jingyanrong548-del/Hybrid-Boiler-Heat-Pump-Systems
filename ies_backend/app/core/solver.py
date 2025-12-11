# app/core/solver.py
from app.core.physics import estimate_enthalpy, calculate_adjusted_dew_point
from app.core.cycles import calculate_cop
from app.core.constants import FUEL_DB

class SchemeCSolver:
    def __init__(self, tolerance=0.5, max_iter=1000):
        # 🟢 修改1: 容差放大到 0.5kW (工程上足够了)，次数加到 1000
        self.tolerance = tolerance 
        self.max_iter = max_iter

    def calculate_flue_heat_release(self, t_in, t_out, flow_vol, fuel_type, excess_air=1.2):
        # 1. 显热计算
        cp_vol_mj = 0.00038 * 3600 
        sensible_kw = (flow_vol * cp_vol_mj * (t_in - t_out)) / 3600.0
        
        # 2. 潜热计算
        latent_kw = 0.0
        fuel_data = FUEL_DB.get(fuel_type, FUEL_DB['NATURAL_GAS'])
        actual_dew_point = calculate_adjusted_dew_point(fuel_data["dewPointRef"], excess_air)
        
        if t_out < actual_dew_point:
            max_latent_per_m3 = 160.0 if fuel_type == 'NATURAL_GAS' else 0.0
            cond_factor = (actual_dew_point - t_out) / (actual_dew_point - 30.0)
            cond_factor = max(0.0, min(1.0, cond_factor))
            total_latent_potential = flow_vol * max_latent_per_m3 / 3600.0 
            latent_kw = total_latent_potential * cond_factor

        return sensible_kw + latent_kw

    def solve(self, req):
        # 计算目标
        h_in = estimate_enthalpy(req.sink_in_temp)
        h_out = estimate_enthalpy(req.sink_out_target, req.mode == 'STEAM')
        q_sink_target_kw = (req.sink_flow_kg_h * (h_out - h_in)) / 3600.0

        print(f"\n=== 开始计算 (流量: {req.sink_flow_kg_h} kg/h) ===")
        print(f"目标负荷: {q_sink_target_kw:.1f} kW")

        t_source_in = req.source_in_temp
        current_t_source_out = 60.0 
        
        for i in range(self.max_iter):
            # A. COP
            t_evap = current_t_source_out - 5.0
            t_cond = req.sink_out_target + 5.0
            cycle_res = calculate_cop(t_evap, t_cond, req.efficiency, req.mode, "STRATEGY_GEN")
            cop = cycle_res["cop"]

            # B. 需求
            cop_factor = (cop - 1) / cop if cop > 1.0 else 0
            q_source_needed = q_sink_target_kw * cop_factor

            # C. 供给
            q_source_avail = self.calculate_flue_heat_release(
                t_source_in, current_t_source_out, req.source_flow_vol, req.fuel_type
            )

            # D. 误差
            diff = q_source_avail - q_source_needed

            # E. 打印进度 (每50次或快成功时打印)
            if i % 50 == 0 or abs(diff) < 5.0:
                print(f"Iter {i}: 排烟 {current_t_source_out:.2f}°C | 供给 {q_source_avail:.1f} vs 需求 {q_source_needed:.1f} | 差值 {diff:.1f}")

            # F. 收敛判定
            if abs(diff) < self.tolerance:
                print(f"✅ 收敛成功! 最终排烟: {current_t_source_out:.2f}°C")
                return {
                    "status": "converged",
                    "iterations": i + 1,
                    "target_load_kw": round(q_sink_target_kw, 1),
                    "required_source_out": round(current_t_source_out, 2),
                    "final_cop": cop,
                    "source_total_kw": round(q_source_avail, 1)
                }

            # G. 动态步长 (🟢 修改2: 加大调整力度 0.005 -> 0.01)
            step = diff * 0.01 
            current_t_source_out += step
            
            # 边界保护
            if current_t_source_out >= t_source_in: current_t_source_out = t_source_in - 0.1
            if current_t_source_out < 30.0: current_t_source_out = 30.0

        print("❌ 计算失败: 达到最大迭代次数")
        return {"status": "failed", "reason": "无法收敛: 可能需要更多迭代或热源不足"}