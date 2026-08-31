from flask import Flask, send_from_directory, request
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)  


FILE_DIR = os.path.join(app.root_path, 'file')


@app.route('/file/<filename>', methods=['GET'])
def serve_file(filename):
    print(f"มีคนขอโหลดไฟล์: {filename} จาก IP: {request.remote_addr}")
    
    return send_from_directory(FILE_DIR, filename)

@app.route('/')
def home():
    return ""

if __name__ == '__main__':
    app.run(port=5000, debug=True)