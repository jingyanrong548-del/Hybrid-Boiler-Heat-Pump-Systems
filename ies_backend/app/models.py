# app/models.py
from pydantic import BaseModel

# 定义前端发过来的数据格式
class StandardCalcRequest(BaseModel):
    source_temp: float      # 热源进水温度
    target_temp: float      # 目标出水温度
    efficiency: float = 0.55 # 完善度，默认 0.55
    mode: str = "WATER"     # WATER 或 STEAM
    strategy: str = "STRATEGY_PRE"
    # === 新增：方案C 的输入数据格式 ===
class SchemeCRequest(BaseModel):
    sink_in_temp: float      # 补水温度 (e.g. 20)
    sink_out_target: float   # 目标水温 (e.g. 90)
    sink_flow_kg_h: float    # 水流量 (e.g. 50000 kg/h)
    
    source_in_temp: float    # 烟气进口温度 (e.g. 130)
    source_flow_vol: float   # 烟气流量 (e.g. 30000 m3/h)
    
    efficiency: float = 0.55 # 完善度
    mode: str = "WATER"      # WATER 或 STEAM
    fuel_type: str = "NATURAL_GAS" # 燃料类型(影响比热容)