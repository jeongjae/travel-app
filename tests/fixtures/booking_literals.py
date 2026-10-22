"""Synthetic source for a future read-only AST extractor. Never import/run this file."""
PILOT_BOOKINGS = [
    {"id": "booking-code", "slug": "shared-source-slug", "name": "가상 코드 예약",
     "day": 1, "date": "2026-10-31", "schedule": "오후", "canonical_status": "needs-review",
     "stage": "가상 확인 필요", "when": "판매 시작 시", "action_date": None,
     "pass_note": "가상 패스 설명", "plan_b": "야외 산책", "note": "예약 실행 아님"}
]
UNSUPPORTED_BOOKINGS = PILOT_BOOKINGS + [{"id": "computed"}]
raise RuntimeError("This source fixture must never be executed")
