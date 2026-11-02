#!/usr/bin/env python3
"""
Makes the check-in QR code as a PNG and a printable A5 PDF poster.

Usage:
  python3 scripts/make-qr.py https://<user>.github.io/rpm-app/checkin.html
Optional:
  --name "Renewed Purpose Ministry"   church name on the poster
  --logo site/icons/logo-black.png    logo at the top of the poster
  --out  qr                           output folder
Needs: pip install qrcode reportlab pillow
"""
import argparse
import os

import qrcode
from qrcode.constants import ERROR_CORRECT_H
from reportlab.lib.pagesizes import A5
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--name", default="Renewed Purpose Ministry")
    ap.add_argument("--logo", default=os.path.join(ROOT, "site", "icons", "logo-black.png"))
    ap.add_argument("--out", default=os.path.join(ROOT, "qr"))
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)

    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=20, border=2)
    qr.add_data(a.url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    png = os.path.join(a.out, "checkin-qr.png")
    img.save(png)

    pdf = os.path.join(a.out, "checkin-poster-A5.pdf")
    w, h = A5
    c = canvas.Canvas(pdf, pagesize=A5)
    c.setTitle("Scan to check in")

    y = h - 18 * mm
    if a.logo and os.path.exists(a.logo):
        logo = ImageReader(a.logo)
        lw, lh = logo.getSize()
        draw_w = 90 * mm
        draw_h = draw_w * lh / lw
        y -= draw_h
        c.drawImage(logo, (w - draw_w) / 2, y, draw_w, draw_h, mask="auto")
        y -= 8 * mm
    else:
        c.setFont("Times-Bold", 22)
        y -= 10 * mm
        c.drawCentredString(w / 2, y, a.name)
        y -= 10 * mm

    c.setFont("Helvetica-Bold", 30)
    y -= 12 * mm
    c.drawCentredString(w / 2, y, "Scan to check in")
    c.setFont("Helvetica", 13)
    y -= 8 * mm
    c.drawCentredString(w / 2, y, "Point your phone camera at the code")

    size = 95 * mm
    y -= size + 6 * mm
    c.drawImage(ImageReader(png), (w - size) / 2, y, size, size)

    c.setFont("Helvetica", 11)
    c.drawCentredString(w / 2, 22 * mm, "First time here? We'd love to welcome you.")
    c.setFont("Helvetica", 8)
    c.setFillGray(0.35)
    c.drawCentredString(w / 2, 14 * mm, a.url)
    c.showPage()
    c.save()

    print("PNG:", png)
    print("PDF:", pdf)


if __name__ == "__main__":
    main()
