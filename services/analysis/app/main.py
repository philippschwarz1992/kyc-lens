"""
HTTP surface of the analysis service. It is stateless: uploads are parsed into memory (never spooled to disk),
analysed and dropped with the request, and nothing derived from the media is logged.
"""

from __future__ import annotations

import hmac
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from python_multipart import MultipartParser
from python_multipart.multipart import parse_options_header

from .config import get_settings
from .document import InvalidImage
from .pipeline import Analyzer, Uploads
from .schema import Applicant, Metadata, VerificationResult

logger = logging.getLogger("kyc_lens.analysis")
FILE_FIELDS = {"documentFront", "documentBack", "selfie", "faceVideo"}
FIELDS = FILE_FIELDS | {"metadata", "applicant"}


class RequestError(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .ocr import engine
    app.state.analyzer = Analyzer(get_settings().models_dir)
    engine()
    yield


app = FastAPI(title="kyc-lens analysis", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.exception_handler(RequestError)
async def request_error(_: Request, error: RequestError) -> JSONResponse:
    return JSONResponse({"error": error.message}, status_code=error.status)


@app.get("/health")
async def health(request: Request) -> dict:
    return {"status": "ok", "ready": hasattr(request.app.state, "analyzer")}


async def read_body(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise RequestError(413, "The upload is too large.")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise RequestError(413, "The upload is too large.")
    return bytes(body)


def parse_multipart(content_type: str, body: bytes) -> dict[str, bytes]:
    """The known form fields as bytes, parsed in memory."""
    kind, params = parse_options_header(content_type)
    boundary = params.get(b"boundary")
    if kind != b"multipart/form-data" or not boundary:
        raise RequestError(400, "Send multipart/form-data.")
    parts: dict[str, bytes] = {}
    state: dict = {}

    def on_part_begin() -> None:
        state.update(headers={}, field=b"", value=b"", data=bytearray())

    def on_header_field(data: bytes, start: int, end: int) -> None:
        state["field"] += data[start:end]

    def on_header_value(data: bytes, start: int, end: int) -> None:
        state["value"] += data[start:end]

    def on_header_end() -> None:
        state["headers"][state["field"].lower()] = state["value"]
        state["field"], state["value"] = b"", b""

    def on_part_data(data: bytes, start: int, end: int) -> None:
        state["data"].extend(data[start:end])

    def on_part_end() -> None:
        _, disposition = parse_options_header(state["headers"].get(b"content-disposition", b""))
        name = disposition.get(b"name", b"").decode("utf-8", "replace")
        if name in FIELDS:
            if name in parts:
                raise RequestError(400, f"{name} was sent more than once.")
            parts[name] = bytes(state["data"])

    parser = MultipartParser(boundary, {
        "on_part_begin": on_part_begin, "on_header_field": on_header_field, "on_header_value": on_header_value,
        "on_header_end": on_header_end, "on_part_data": on_part_data, "on_part_end": on_part_end,
    }, max_header_count=16)
    try:
        parser.write(body)
        parser.finalize()
    except RequestError:
        raise
    except Exception as error:
        raise RequestError(400, "The multipart body is malformed.") from error
    return parts


def authorize(request: Request, secret: str) -> None:
    if not secret:
        raise RequestError(503, "ANALYSIS_SECRET is not configured.")
    supplied = request.headers.get("x-analysis-secret", "")
    if not hmac.compare_digest(supplied.encode(), secret.encode()):
        raise RequestError(401, "Missing or wrong X-Analysis-Secret.")


@app.post("/analyze", response_model=VerificationResult)
async def analyze(request: Request) -> VerificationResult:
    settings = get_settings()
    authorize(request, settings.secret)
    parts = parse_multipart(request.headers.get("content-type", ""), await read_body(request, settings.max_upload_bytes))
    for name in ("documentFront", "selfie", "metadata"):
        if not parts.get(name):
            raise RequestError(400, f"{name} is required.")
    try:
        metadata = Metadata.model_validate(json.loads(parts["metadata"]))
    except (ValueError, ValidationError) as error:
        raise RequestError(400, "metadata is not valid JSON of the expected shape.") from error
    applicant = None
    if parts.get("applicant"):
        try:
            applicant = Applicant.model_validate(json.loads(parts["applicant"]))
        except (ValueError, ValidationError) as error:
            raise RequestError(400, "applicant is not valid JSON of the expected shape.") from error
    uploads = Uploads(document_front=parts["documentFront"], selfie=parts["selfie"], metadata=metadata,
                      document_back=parts.get("documentBack") or None, face_video=parts.get("faceVideo") or None,
                      applicant=applicant)
    del parts
    try:
        return await run_in_threadpool(request.app.state.analyzer.analyze, uploads, settings)
    except InvalidImage as error:
        raise RequestError(422, str(error)) from error
    except Exception as error:
        # Handled here so the server never prints a traceback: messages could quote request content.
        logger.error("Analysis failed: %s", type(error).__name__)
        raise RequestError(500, "Analysis failed.") from None
