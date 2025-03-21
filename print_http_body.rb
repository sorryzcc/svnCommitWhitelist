require 'webrick'
require 'json'

server = WEBrick::HTTPServer.new(Port: ARGV.first.to_i)

server.mount_proc '/' do |req, res|
  begin
    response = { status: 200, message: 'Success' }

    if req.request_method == 'POST'
      # 检查 Content-Type
      unless req.content_type.to_s.start_with?('application/json')
        raise "Invalid Content-Type: #{req.content_type}"
      end

      # 解析 JSON 请求体
      request_body = JSON.parse(req.body)
      puts "Received Request Body: #{request_body}"

      # 示例业务逻辑（确保所有字段存在）
      unless request_body['revision'] && request_body['user_id']
        raise "Missing required fields: revision or user_id"
      end

      # 处理请求（根据需求添加逻辑）
      response[:message] = "Processed commit by #{request_body['user_name']}"
    end

    res.status = response[:status]
    res['Content-Type'] = 'application/json'
    res.body = JSON.generate(response)
  rescue JSON::ParserError => e
    handle_error(res, 400, "Invalid JSON: #{e.message}")
  rescue KeyError, ArgumentError => e
    handle_error(res, 400, "Bad Request: #{e.message}")
  rescue StandardError => e
    handle_error(res, 500, "Internal Error: #{e.message}")
  end
end

def handle_error(res, status, message)
  res.status = status
  res.body = JSON.generate({ status: status, message: message })
  puts "Error: #{message}"
end

trap 'INT' do
  server.shutdown
end

server.start