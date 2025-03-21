import http.server
import socketserver
import json
import sys
import signal

class RequestHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # 检查Content-Type
            content_type = self.headers.get('Content-Type', '')
            if not content_type.startswith('application/json'):
                self.send_error(400, f"Invalid Content-Type: {content_type}")
                return

            # 读取请求体并打印
            content_length = int(self.headers['Content-Length'])
            request_body = self.rfile.read(content_length)
            request_data = json.loads(request_body.decode('utf-8'))
            print(f"Received Request Body: {request_data}")  # 打印请求体内容

            # 验证必填字段
            required_fields = ['revision', 'user_id']
            missing = [field for field in required_fields if field not in request_data]
            if missing:
                raise KeyError(f"Missing required fields: {', '.join(missing)}")

            # 业务逻辑处理
            user_name = request_data.get('user_name', 'unknown user')
            response_message = f"Processed commit by {user_name}"
            response = {
                "status": 200,
                "message": response_message
            }

            # 构建响应并打印
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode('utf-8'))
            print(f"Sent Response: {response}")  # 打印响应内容

        except json.JSONDecodeError as e:
            self.handle_error(400, f"Invalid JSON: {str(e)}")
        except (KeyError, ValueError) as e:
            self.handle_error(400, f"Bad Request: {str(e)}")
        except Exception as e:
            self.handle_error(500, f"Internal Error: {str(e)}")

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        response = {"status": 200, "message": "Success"}
        self.wfile.write(json.dumps(response).encode('utf-8'))
        print(f"Sent Response: {response}")  # 打印GET响应

    def handle_error(self, status, message):
        error_response = {
            "status": status,
            "message": message
        }
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(error_response).encode('utf-8'))
        print(f"Error: {message}")  # 打印错误信息

def run_server(port):
    with socketserver.TCPServer(("", port), RequestHandler) as httpd:
        print(f"Server running on port {port}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("Shutting down server...")
            httpd.shutdown()

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python server.py <port>")
        sys.exit(1)

    port = int(sys.argv[1])
    run_server(port)