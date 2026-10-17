import os
import re
import uuid

import boto3
from botocore.config import Config

from db import run_auth, ok, ApiError
from validation import get_user, user_key_prefix

EXPIRES_IN = 300  # วินาที
_s3 = boto3.client("s3", config=Config(signature_version="s3v4"))


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _presign(conn, auth["userId"], event))


def _first(params, *names):
    for name in names:
        value = params.get(name)
        if value not in (None, ""):
            return str(value).strip()
    return ""


def _safe_filename(filename):
    name = os.path.basename(filename.replace("\\", "/"))
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:100].strip("._")
    return name or "file"


def _presign(conn, user_id, event):
    params = event.get("queryStringParameters") or {}

    filename = _first(params, "filename", "fileName", "file_name")
    if not filename:
        raise ApiError(400, "ต้องระบุ filename")
    content_type = _first(params, "contentType", "fileType", "content_type") or None

    get_user(conn, user_id)

    bucket = os.environ.get("UPLOAD_BUCKET") or os.environ.get("S3_UPLOADS_BUCKET")
    if not bucket:
        raise RuntimeError("UPLOAD_BUCKET environment variable is not set")
        
    key = f"{user_key_prefix(user_id)}{uuid.uuid4().hex}-{_safe_filename(filename)}"

    signed = {"Bucket": bucket, "Key": key}
    if content_type:
        signed["ContentType"] = content_type

    url = _s3.generate_presigned_url(
        "put_object", Params=signed, ExpiresIn=EXPIRES_IN, HttpMethod="PUT"
    )
    
    return ok(
        200,
        {
            "uploadUrl": url,
            "fileKey": key,
            "s3Bucket": bucket,
            "method": "PUT",
            "contentType": content_type,
            "expiresIn": EXPIRES_IN,
        },
    )