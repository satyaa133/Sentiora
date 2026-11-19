"""Thin email service: logs OTP to console when SMTP is not configured."""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def send_otp_email(to_email: str, otp: str) -> None:
    """Send the OTP to *to_email*.

    Falls back to a prominent console log when SMTP is not configured
    (suitable for local development without an email provider).
    """
    settings = get_settings()

    if not settings.smtp_host:
        logger.info(
            "\n%s\n📧  OTP for %s:  %s\n%s",
            "=" * 60,
            to_email,
            otp,
            "=" * 60,
        )
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Your Sentiora verification code: {otp}"
    msg["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
    msg["To"] = to_email

    plain = (
        f"Your Sentiora email verification code is: {otp}\n\n"
        "This code expires in 10 minutes. Do not share it with anyone.\n\n"
        "If you did not create a Sentiora account, ignore this email."
    )
    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#1a1a1a;max-width:480px;margin:0 auto;padding:32px 16px">
  <h2 style="margin-bottom:8px">Verify your email</h2>
  <p>Use the code below to verify your Sentiora account:</p>
  <div style="font-size:36px;font-weight:bold;letter-spacing:8px;margin:24px 0;color:#6c47ff">{otp}</div>
  <p style="color:#666;font-size:14px">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
  <p style="color:#999;font-size:12px">If you did not create a Sentiora account, ignore this email.</p>
</body>
</html>"""

    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            server.sendmail(settings.smtp_from_email, to_email, msg.as_string())
        logger.info("OTP email sent to %s", to_email)
    except Exception:
        logger.exception("Failed to send OTP email to %s", to_email)
        raise
