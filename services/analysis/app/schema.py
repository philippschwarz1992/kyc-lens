"""The request metadata and the VerificationResult the service returns."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

DocumentType = Literal["id-card", "drivers-license", "passport"]


# --- Request ------------------------------------------------------------------------------------------------------

class MrzSummaryIn(BaseModel):
    """What the SDK read on the device. A capture aid only; the service reads the zone itself."""
    format: Literal["TD1", "TD2", "TD3"]
    kind: Literal["passport", "id-card", "visa", "other"]
    valid: bool


class DocumentMetadata(BaseModel):
    type: DocumentType
    mrz: MrzSummaryIn | None = None


class Metadata(BaseModel):
    """The `metadata` field packages/sdk/src/api.ts sends."""
    model_config = ConfigDict(extra="allow")

    challenges: list[dict] = Field(default_factory=list)
    capturedAt: str | None = None
    mode: str | None = None
    document: DocumentMetadata | None = None


# --- Response -----------------------------------------------------------------------------------------------------

class Quality(BaseModel):
    sharpness: float = Field(description="Variance of the Laplacian at 1000 px width; higher is sharper.")
    glare: float = Field(description="Share of near-white pixels, 0–1.")
    brightness: float = Field(description="Mean grey level, 0–255.")
    rectified: bool = Field(description="The document outline was found and flattened.")
    acceptable: bool
    issues: list[Literal["blurry", "glare", "too-dark", "too-bright"]]


class MrzFields(BaseModel):
    documentCode: str
    issuingState: str
    documentNumber: str
    surname: str
    givenNames: str
    nationality: str
    birthDate: str | None = Field(description="ISO 8601 date, null when the zone holds no real date.")
    sex: Literal["M", "F", "X"]
    expiryDate: str | None
    optionalData: str | None


class Mrz(BaseModel):
    format: Literal["TD1", "TD2", "TD3"]
    kind: Literal["passport", "id-card", "visa", "other"]
    valid: bool = Field(description="Every check digit matches and the dates are real calendar dates.")
    fields: MrzFields


class PrintedFields(BaseModel):
    """
    The printed data (visual inspection zone), read by label or by EU driving licence field number. Text is upper
    case without diacritics, transliterated as in the MRZ (MÜLLER becomes MUELLER); dates are ISO 8601. A field
    that is not printed, or not read, is null.
    """
    surname: str | None = None
    givenNames: str | None = None
    documentNumber: str | None = None
    nationality: str | None = None
    birthDate: str | None = None
    placeOfBirth: str | None = None
    sex: Literal["M", "F", "X"] | None = None
    issueDate: str | None = None
    expiryDate: str | None = None


class Document(BaseModel):
    type: DocumentType | None = Field(description="Detected from the zone, or from printed keywords without one.")
    quality: Quality
    mrz: Mrz | None
    printedFields: PrintedFields | None = Field(default=None, description="Null when no labelled field was read.")
    fieldMismatches: list[Literal["documentNumber", "surname", "givenNames", "birthDate", "expiryDate", "sex"]] = Field(
        default_factory=list, description="Fields where the printed data and a valid MRZ disagree.")
    ocrText: str | None = None


class FaceMatch(BaseModel):
    score: float = Field(description="Cosine similarity of the document portrait and the selfie.")
    threshold: float
    decision: Literal["match", "no-match"]


class LiveFaceMatch(BaseModel):
    """The document portrait against the live face in the sampled video frames."""
    score: float = Field(description="Median cosine similarity over the frames that show a face.")
    threshold: float
    decision: Literal["match", "no-match"]
    framesCompared: int
    framesMatched: int


class Liveness(BaseModel):
    score: float = Field(description="Mean passive anti-spoofing real-face probability, 0–1.")
    decision: Literal["pass", "fail"]
    framesWithFace: int
    framesSampled: int


class VerificationResult(BaseModel):
    status: Literal["approved", "review", "rejected"]
    reasons: list[str]
    document: Document
    faceMatch: FaceMatch | None = Field(description="The document portrait against the selfie.")
    liveFaceMatch: LiveFaceMatch | None = Field(description="The document portrait against the face video.")
    liveness: Liveness | None
