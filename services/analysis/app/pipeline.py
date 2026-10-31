"""One analysis: document, zone, face match, liveness and the decision. Everything stays in memory."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np

from .applicant import check_applicant
from .config import Settings
from .document import decode_image, measure_quality, rectify
from .face import FaceModels
from .liveness import InvalidVideo, SpoofModels, check_liveness, sample_frames
from .mrz import DecodedMrz, mrz_fields
from .ocr import read_side, type_from_text
from .schema import (Applicant, Document, DocumentType, FaceMatch, LiveFaceMatch, Liveness, Metadata, Mrz, MrzFields, PrintedFields,
                     VerificationResult)
from .viz import mismatches, read_printed_fields, respace

# Reasons that reject outright; every other reason sends the capture to manual review.
REJECTING = {"document-expired", "document-type-mismatch", "face-mismatch", "live-face-mismatch", "liveness-failed"}
# Liveness failures that point at an attack rather than a poor recording.
ATTACK_SIGNS = {"liveness-identity-mismatch", "liveness-no-motion", "liveness-spoof-suspected"}
MRZ_TYPES: dict[str, DocumentType] = {"passport": "passport", "id-card": "id-card"}


@dataclass
class Uploads:
    document_front: bytes
    selfie: bytes
    metadata: Metadata
    document_back: bytes | None = None
    face_video: bytes | None = None
    applicant: Applicant | None = None


class Analyzer:
    def __init__(self, models_dir: Path):
        self.faces = FaceModels(models_dir)
        self.spoof = SpoofModels(models_dir)

    def analyze(self, uploads: Uploads, settings: Settings, today: date | None = None) -> VerificationResult:
        today = today or date.today()
        reasons: list[str] = []

        # Document photos: rectified, measured and read.
        front, front_flat = rectify(decode_image(uploads.document_front))
        sides = [(front, front_flat)]
        if uploads.document_back:
            sides.append(rectify(decode_image(uploads.document_back)))
        quality = measure_quality(front, front_flat, settings)
        if not quality.acceptable or any(not measure_quality(image, flat, settings).acceptable for image, flat in sides[1:]):
            reasons.append("document-quality-poor")
        declared = uploads.metadata.document.type if uploads.metadata.document else None
        # Each side turned upright; everything after this reads the upright images.
        reads = [read_side(image, expect_mrz=declared != "drivers-license") for image, _ in sides]
        boxes = [read.lines for read in reads]
        ocr_text = "\n".join(line.text for side in boxes for line in side) or None

        decoded: DecodedMrz | None = None
        for read in reads:
            candidate = read.mrz
            if candidate is not None and (decoded is None or (candidate.summary.valid, candidate.confidence) > (decoded.summary.valid, decoded.confidence)):
                decoded = candidate
        mrz = None
        if decoded is not None:
            fields = mrz_fields(decoded.lines, decoded.summary.format)
            mrz = Mrz(format=decoded.summary.format, kind=decoded.summary.kind, valid=decoded.summary.valid, fields=MrzFields(**fields))
            if not mrz.valid:
                reasons.append("mrz-invalid")
            elif fields["expiryDate"] and date.fromisoformat(fields["expiryDate"]) < today:
                reasons.append("document-expired")

        detected = MRZ_TYPES.get(mrz.kind) if mrz is not None and mrz.valid else None
        detected = detected or type_from_text(ocr_text or "")
        if declared and detected and declared != detected:
            reasons.append("document-type-mismatch")
        if detected is None:
            reasons.append("document-type-unknown")
        if mrz is None and (declared or detected) in ("passport", "id-card"):
            reasons.append("mrz-not-found")

        # Printed data, front first; the back fills what the front lacks.
        licence = (declared or detected) == "drivers-license"
        printed: dict[str, str] = {}
        for side in boxes:
            printed = read_printed_fields(side, licence) | printed
        field_mismatches = []
        if mrz is not None and mrz.valid:
            printed = respace(printed, mrz.fields.model_dump())
            field_mismatches = mismatches(printed, mrz.fields.model_dump())
        if field_mismatches:
            reasons.append("printed-data-mismatch")
        if (mrz is None or not mrz.valid) and printed.get("expiryDate") and date.fromisoformat(printed["expiryDate"]) < today:
            # Without a valid zone the printed date is all there is, but a misread digit must not reject on its own.
            reasons.append("printed-expiry-passed")

        # The applicant data the customer's backend sent, against the zone and the page.
        applicant_check = check_applicant(uploads.applicant, mrz, printed) if uploads.applicant else None
        if applicant_check is not None and applicant_check.result == "mismatch":
            reasons.append("applicant-data-mismatch")
        elif applicant_check is not None and applicant_check.result == "incomplete":
            reasons.append("applicant-data-not-read")

        # Face: the upscaled document portrait against the selfie.
        selfie_image = decode_image(uploads.selfie)
        selfie_face = self.faces.largest(selfie_image)
        selfie_embedding = self.faces.embed(selfie_image, selfie_face) if selfie_face is not None else None
        if selfie_embedding is None:
            reasons.append("selfie-face-not-found")
        portrait = None
        for read in reads:
            portrait = self.faces.document_portrait(read.image)
            if portrait is not None:
                break
        if portrait is None:
            reasons.append("document-face-not-found")
        portrait_embedding = self.faces.embed(*portrait) if portrait is not None else None
        face_match = None
        if portrait_embedding is not None and selfie_embedding is not None:
            score = self.faces.similarity(portrait_embedding, selfie_embedding)
            matched = score >= settings.face_match_threshold
            face_match = FaceMatch(score=round(score, 4), threshold=settings.face_match_threshold, decision="match" if matched else "no-match")
            if not matched:
                reasons.append("face-mismatch")

        liveness, live_face_match = None, None
        if uploads.face_video:
            try:
                frames = sample_frames(uploads.face_video, settings.liveness_frames)
            except InvalidVideo:
                frames = []
            check = check_liveness(frames, selfie_embedding, self.faces, self.spoof,
                                   match_threshold=settings.face_match_threshold, threshold=settings.liveness_threshold,
                                   min_frames=settings.liveness_min_frames, min_motion=settings.liveness_min_motion)
            liveness = Liveness(score=check.score, decision="pass" if check.passed else "fail",
                                framesWithFace=check.frames_with_face, framesSampled=check.frames_sampled)
            if not check.passed:
                reasons.append("liveness-failed" if ATTACK_SIGNS & set(check.failures) else "liveness-inconclusive")
                reasons.extend(check.failures)
            # The person in the video must also be the person on the document, not only the selfie's.
            if portrait_embedding is not None and check.embeddings:
                live_face_match = self._live_face_match(portrait_embedding, check.embeddings, settings.face_match_threshold)
                if live_face_match.decision == "no-match":
                    reasons.append("live-face-mismatch")
        elif settings.require_liveness:
            reasons.append("liveness-missing")

        status = "rejected" if REJECTING & set(reasons) else "review" if reasons else "approved"
        return VerificationResult(status=status, reasons=reasons,
                                  document=Document(type=detected, quality=quality, mrz=mrz, ocrText=ocr_text,
                                                    printedFields=PrintedFields(**printed) if printed else None,
                                                    fieldMismatches=field_mismatches),
                                  faceMatch=face_match, liveFaceMatch=live_face_match, liveness=liveness,
                                  applicantCheck=applicant_check)

    def _live_face_match(self, portrait: np.ndarray, frames: list[np.ndarray], threshold: float) -> LiveFaceMatch:
        """The median keeps one blurred or turned-away frame from deciding either way."""
        scores = [self.faces.similarity(portrait, frame) for frame in frames]
        score = float(np.median(scores))
        return LiveFaceMatch(score=round(score, 4), threshold=threshold, decision="match" if score >= threshold else "no-match",
                             framesCompared=len(scores), framesMatched=sum(value >= threshold for value in scores))
