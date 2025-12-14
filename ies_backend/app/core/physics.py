import math

# === 移植自 src/core/physics.js ===

def calculate_atmospheric_pressure(altitude_m: float) -> float:
    """
    根据海拔计算实际大气压力
    使用国际标准大气模型 (ISA)
    对应 JS: calculateAtmosphericPressure
    """
    # 海平面标准大气压: 101.325 kPa
    P0 = 101.325  # kPa
    T0 = 288.15  # K (15°C)
    L = 0.0065  # K/m (温度递减率)
    g = 9.80665  # m/s² (重力加速度)
    M = 0.0289644  # kg/mol (干空气摩尔质量)
    R = 8.31447  # J/(mol·K) (通用气体常数)
    
    if altitude_m < 0:
        altitude_m = 0  # 海平面以下按海平面处理
    
    # 标准大气模型: P = P0 * (1 - L*h/T0)^(g*M/(R*L))
    exponent = (g * M) / (R * L)
    pressure = P0 * pow(1 - (L * altitude_m) / T0, exponent)
    
    return round(pressure, 3)

def get_sat_temp_from_pressure(pressure_mpa: float, atmospheric_pressure_kpa: float = 101.325) -> float:
    """
    根据绝对压力计算饱和温度 (R134a/Water 简化拟合)
    对应 JS: getSatTempFromPressure
    """
    if pressure_mpa <= 0:
        return 100.0
    
    # 如果输入的是表压，需要加上大气压得到绝对压力
    absolute_pressure_mpa = pressure_mpa
    if pressure_mpa < 0.5:
        # 可能是表压，转换为绝对压力
        absolute_pressure_mpa = pressure_mpa + (atmospheric_pressure_kpa / 1000)
    
    # Antoine Equation approximation
    p_mmhg = absolute_pressure_mpa * 7500.62
    A, B, C = 8.07131, 1730.63, 233.426
    
    # 注意：Python 的 log10 在 math 库里
    val = B / (A - math.log10(p_mmhg)) - C
    return round(val, 1)

def estimate_enthalpy(temp_c: float, is_steam: bool = False) -> float:
    """
    估算焓值 (简化工程模型)
    对应 JS: estimateEnthalpy
    """
    if not is_steam:
        return 4.187 * temp_c  # Cp_water ≈ 4.187
    else:
        return 2676 + 0.5 * (temp_c - 100) # 饱和蒸汽基准 + 过热

# === 新增：燃烧物理修正 ===

def calculate_actual_flue_volume(theo_gas: float, theo_air: float, alpha: float) -> float:
    """
    计算实际烟气生成量 (考虑过量空气)
    公式: V_actual = V_theo + (alpha - 1) * V_air_theo
    """
    safe_alpha = max(1.0, alpha if alpha else 1.2)
    excess_air = (safe_alpha - 1.0) * theo_air
    return theo_gas + excess_air

def calculate_adjusted_dew_point(ref_dew_point: float, alpha: float) -> float:
    """
    计算修正后的露点温度
    工程近似: 过量空气系数每增加 0.1，露点下降约 1.7度
    """
    if not ref_dew_point or ref_dew_point <= 0: return 0.0
    
    safe_alpha = max(1.0, alpha if alpha else 1.2)
    K_DECAY = 17.0 # 衰减系数
    
    adjusted = ref_dew_point - K_DECAY * (safe_alpha - 1.0)
    return round(adjusted, 1)

def calculate_water_vapor_saturation_pressure(temp_c: float) -> float:
    """
    计算水蒸气的饱和压力 (Antoine方程)
    对应 JS: calculateWaterVaporSaturationPressure
    """
    # Antoine方程: log10(P) = A - B/(C + T)
    # 对于水: A=8.07131, B=1730.63, C=233.426 (T in °C, P in mmHg)
    A = 8.07131
    B = 1730.63
    C = 233.426
    T = temp_c
    
    log10_p_mmhg = A - B / (C + T)
    p_mmhg = 10 ** log10_p_mmhg
    p_kpa = p_mmhg * 0.133322  # 1 mmHg = 0.133322 kPa
    
    return p_kpa

def calculate_water_condensation(flue_in_temp: float, flue_out_temp: float, 
                                  flue_vol_flow: float, h2o_vol_percent: float, 
                                  dew_point: float) -> dict:
    """
    计算烟气冷却过程中的水分析出量
    对应 JS: calculateWaterCondensation
    """
    # 如果最终温度 >= 露点，没有水分析出
    if flue_out_temp >= dew_point:
        return {
            "condensed_water": 0.0,
            "initial_water": 0.0,
            "final_water": 0.0
        }
    
    # 标准状态参数
    T_STP = 273.15  # 0°C = 273.15 K
    # 注意：P_STP 应该使用实际大气压力，但这里保持兼容性
    P_STP = 101.325  # 标准大气压 (kPa)，实际计算中应使用实际大气压
    R_H2O = 0.4615  # 水蒸气气体常数 (kJ/(kg·K))
    
    # 1. 计算初始水蒸气质量
    # 水蒸气体积流量 (标准状态)
    h2o_vol_flow_stp = flue_vol_flow * (h2o_vol_percent / 100)
    
    # 水蒸气在标准状态下的密度 (kg/m³)
    # 理想气体状态方程: ρ = P / (R * T)
    h2o_density_stp = P_STP / (R_H2O * T_STP)  # kg/m³
    initial_water = h2o_vol_flow_stp * h2o_density_stp  # kg/h
    
    # 2. 计算最终温度下的饱和水蒸气分压
    sat_pressure = calculate_water_vapor_saturation_pressure(flue_out_temp)  # kPa
    
    # 3. 计算最终温度下的水蒸气分压
    # 假设烟气总压力为标准大气压
    # 水蒸气分压 = 总压 * 水蒸气摩尔分数
    # 简化：假设水蒸气分压等于饱和压力（当温度低于露点时）
    initial_water_vapor_pressure = P_STP * (h2o_vol_percent / 100)  # kPa
    final_water_vapor_pressure = min(sat_pressure, initial_water_vapor_pressure)
    
    # 4. 计算最终温度下的水蒸气质量
    # 最终温度 (K)
    T_final_K = flue_out_temp + 273.15
    
    # 🔧 修复：正确计算最终水蒸气质量
    # 基于烟气总体积计算最终水蒸气质量
    # 最终水蒸气质量 = 最终分压^2 * 烟气总体积 / (R_H2O * 总压 * 初始温度)
    final_water = (final_water_vapor_pressure * final_water_vapor_pressure * flue_vol_flow) / (R_H2O * P_STP * T_STP)  # kg/h
    
    # 5. 计算析出的水量
    condensed_water = max(0.0, initial_water - final_water)
    
    return {
        "condensed_water": round(condensed_water, 2),
        "initial_water": round(initial_water, 2),
        "final_water": round(final_water, 2)
    }