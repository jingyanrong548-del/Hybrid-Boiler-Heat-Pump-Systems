from http.server import BaseHTTPRequestHandler
import json
import sys
import os

# 添加后端模块路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'ies_backend'))

from app.models import StandardCalcRequest
from app.core.cycles import calculate_cop

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        
        try:
            data = json.loads(body.decode('utf-8'))
            req = StandardCalcRequest(**data)
            
            # 估算蒸发和冷凝温度
            t_evap = req.source_temp - 5.0
            t_cond = req.target_temp + 5.0
            
            # 调用算法核心
            result = calculate_cop(
                evap_temp=t_evap,
                cond_temp=t_cond,
                efficiency=req.efficiency,
                mode=req.mode,
                strategy=req.strategy
            )
            
            response = {
                "input_echo": {
                    "source": req.source_temp,
                    "target": req.target_temp
                },
                "simulation_result": result
            }
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
    
    def do_OPTIONS(self):
        """处理 CORS 预检请求"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
