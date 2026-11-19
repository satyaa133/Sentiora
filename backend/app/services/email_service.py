"""Production-grade email service supporting Resend API and SMTP (SSL/TLS)."""
from concurrent.futures import ThreadPoolExecutor
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid
import logging
import smtplib

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Background executor for non-blocking email delivery
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="email-sender")


def _build_email_html(otp: str) -> str:
    """Generate a responsive, dark-mode-compatible HTML email for Sentiora."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Sentiora Verification Code</title>
  <style>
    body {{
      margin: 0;
      padding: 0;
      background-color: #f7f7f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a1e;
      -webkit-font-smoothing: antialiased;
    }}
    .wrapper {{
      width: 100%;
      background-color: #f7f7f9;
      padding: 40px 16px;
    }}
    .card {{
      max-width: 480px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      padding: 40px 32px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
      border: 1px solid #eaeaea;
    }}
    .logo-badge {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, #6c47ff 0%, #4f46e5 100%);
      color: #ffffff;
      font-weight: 800;
      font-size: 24px;
      margin-bottom: 24px;
    }}
    h1 {{
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 12px 0;
      color: #111827;
      letter-spacing: -0.3px;
    }}
    p {{
      font-size: 15px;
      line-height: 1.6;
      color: #4b5563;
      margin: 0 0 24px 0;
    }}
    .otp-box {{
      background: #f4f3ff;
      border: 1px solid #e0dbff;
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      margin: 28px 0;
    }}
    .otp-code {{
      font-family: 'SF Pro Display', ui-monospace, 'Menlo', 'Monaco', monospace;
      font-size: 38px;
      font-weight: 800;
      letter-spacing: 10px;
      color: #5533ea;
      margin: 0;
      padding-left: 10px;
    }}
    .notice {{
      font-size: 13px;
      color: #6b7280;
      margin: 0 0 16px 0;
      line-height: 1.5;
    }}
    .divider {{
      height: 1px;
      background-color: #f0f0f3;
      margin: 28px 0 20px 0;
    }}
    .footer {{
      font-size: 12px;
      color: #9ca3af;
      line-height: 1.5;
      text-align: center;
    }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo-badge">S</div>
      <h1>Verify your email</h1>
      <p>Welcome to <strong>Sentiora</strong>. Please enter the verification code below to verify your email address and activate your account:</p>
      
      <div class="otp-box">
        <div class="otp-code">{otp}</div>
      </div>
      
      <p class="notice">
        • This code expires in <strong>10 minutes</strong>.<br>
        • For your security, never share this code with anyone.<br>
        • If you didn't request this code, you can safely ignore this email.
      </p>

      <div class="divider"></div>
      <div class="footer">
        Sentiora — AI-Powered Memory & Search<br>
        Sent securely to your email address.
      </div>
    </div>
  </div>
</body>
</html>"""


def _build_email_plain(otp: str) -> str:
    return (
        f"Your Sentiora verification code is: {otp}\n\n"
        "This code expires in 10 minutes. For your security, never share this code with anyone.\n\n"
        "If you did not request this code, you can safely ignore this email.\n\n"
        "— Sentiora Team"
    )


def _send_via_resend(api_key: str, from_name: str, from_email: str, to_email: str, otp: str) -> None:
    """Deliver email via Resend's HTTPS API (resend.com)."""
    subject = f"Your Sentiora verification code: {otp}"
    html = _build_email_html(otp)
    text = _build_email_plain(otp)

    # If from_email is default or unverified domain in free tier, Resend permits onboarding@resend.dev
    sender = f"{from_name} <{from_email}>"
    if "sentiora.app" in from_email and not from_email.endswith("@resend.dev"):
        # Allow fallback to resend onboarding email if custom domain not yet verified
        pass

    payload = {
        "from": sender,
        "to": [to_email],
        "subject": subject,
        "html": html,
        "text": text,
    }

    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key.strip()}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=10.0,
        )
        if response.status_code in (200, 201):
            logger.info("OTP email successfully sent to %s via Resend API", to_email)
            return

        # If user domain was rejected, retry once with onboarding@resend.dev for test accounts
        if response.status_code == 403 and "domain" in response.text.lower():
            logger.warning("Resend rejected custom domain, falling back to onboarding@resend.dev")
            payload["from"] = f"{from_name} <onboarding@resend.dev>"
            fallback_resp = httpx.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key.strip()}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=10.0,
            )
            if fallback_resp.status_code in (200, 201):
                logger.info("OTP email successfully sent to %s via Resend sandbox", to_email)
                return
            response = fallback_resp

        logger.error(
            "Resend API error (%s): %s", response.status_code, response.text
        )
        raise RuntimeError(f"Resend email API returned HTTP {response.status_code}: {response.text}")
    except Exception as exc:
        logger.exception("Failed to send email via Resend to %s: %s", to_email, exc)
        raise


def _send_via_smtp(settings: object, to_email: str, otp: str) -> None:
    """Deliver email via SMTP (supporting Port 465 SSL or Port 587 STARTTLS)."""
    smtp_host = str(getattr(settings, "smtp_host", "") or "").strip()
    smtp_port = int(getattr(settings, "smtp_port", 587) or 587)
    smtp_user = str(getattr(settings, "smtp_user", "") or "").strip()
    smtp_password = str(getattr(settings, "smtp_password", "") or "").strip()
    smtp_from_email = str(getattr(settings, "smtp_from_email", "noreply@sentiora.app") or "").strip()
    smtp_from_name = str(getattr(settings, "smtp_from_name", "Sentiora") or "Sentiora").strip()

    subject = f"Your Sentiora verification code: {otp}"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{smtp_from_name} <{smtp_from_email}>"
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=smtp_from_email.split("@")[-1] if "@" in smtp_from_email else "sentiora.app")

    plain_body = _build_email_plain(otp)
    html_body = _build_email_html(otp)

    msg.attach(MIMEText(plain_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=12) as server:
                server.ehlo()
                if smtp_user:
                    server.login(smtp_user, smtp_password)
                server.sendmail(smtp_from_email, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=12) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                if smtp_user:
                    server.login(smtp_user, smtp_password)
                server.sendmail(smtp_from_email, [to_email], msg.as_string())

        logger.info("OTP email successfully sent to %s via SMTP (%s:%d)", to_email, smtp_host, smtp_port)
    except Exception as exc:
        logger.exception("Failed to send SMTP email to %s: %s", to_email, exc)
        raise


def send_otp_email_now(to_email: str, otp: str) -> None:
    """Deliver OTP email synchronously."""
    settings = get_settings()

    # Priority 1: Resend API (HTTPS)
    if settings.resend_api_key and settings.resend_api_key.strip():
        _send_via_resend(
            api_key=settings.resend_api_key,
            from_name=settings.smtp_from_name,
            from_email=settings.smtp_from_email,
            to_email=to_email,
            otp=otp,
        )
        return

    # Priority 2: SMTP Relay (Gmail, SendGrid, Brevo, AWS SES, Postmark)
    if settings.smtp_host and settings.smtp_host.strip():
        _send_via_smtp(settings, to_email, otp)
        return

    # Priority 3: Development console fallback
    logger.info(
        "\n%s\n📧  [DEV FALLBACK] OTP for %s:  %s\n"
        "    To receive real emails in your inbox, set in your .env:\n"
        "    RESEND_API_KEY=re_... (recommended) OR\n"
        "    SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER=..., SMTP_PASSWORD=...\n%s",
        "=" * 60,
        to_email,
        otp,
        "=" * 60,
    )


def send_otp_email(to_email: str, otp: str) -> None:
    """Send OTP email in background pool for sub-50ms API responsiveness."""
    settings = get_settings()
    # In test environment, execute immediately
    if settings.app_environment == "testing":
        send_otp_email_now(to_email, otp)
        return

    # Send in background thread pool so user API call does not block on external email latency
    _executor.submit(send_otp_email_now, to_email, otp)
