# 🏠 מדריך התקנה ב-Proxmox VE (גרסה מקומית / Standalone)

מדריך זה מסביר כיצד להריץ את גרסת ה-**Standalone (ללא Firebase)** של Kids Tasker ישירות על שרת **Proxmox VE**.

---

## 🌟 יתרונות הגרסה המקומית ב-Proxmox
- ⚡ **תקשורת ישירה ללא CORS**: השרת של Kids Tasker פונה ל-Home Assistant ישירות דרך הרשת המקומית (Server-to-Server). אין צורך בהגדרת `cors_allowed_origins` בדפדפן!
- 🔒 **פרטיות ועצמאות מלאה**: כל הנתונים נשמרים מקומית בקובץ `tasks.json` ללא תלות בענן או בחשבון גוגל.
- 🚀 **סופר קל וחסכוני במשאבים**: צורך כ-**60MB - 100MB RAM** בלבד ב-LXC Container.
- 🔄 **סנכרון מיידי**: תקשורת Socket.io מהירה בזמן אמת בין כל מסכי הבית (טאבלטים, טלפונים של ההורים ו-Home Assistant).

---

## 🛠️ אפשרויות התקנה ב-Proxmox

בחר באחת מ-3 השיטות הנוחות לך:

---

### שיטה 1: התקנה אוטומטית מלאה מתוך ה-Shell של Proxmox (מומלץ ביותר ⭐)

סקריפט זה יוצר מיכל **LXC (Debian 12)** ייעודי, מתקין Node.js 20, מגדיר שירות מערכת (systemd) ומפעיל את האפליקציה תוך כדקה אחת!

1. פתח את ממשק הניהול של **Proxmox VE** בדפדפן.
2. בחר בשרת הראשי (Node) בצד שמאל ולחץ על **Shell** (מסך הטרמינל השחור).
3. הדבק את הפקודה הבאה ולחץ **Enter**:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/volski/kids-tasker/main/proxmox/create-lxc.sh)"
```

4. הסקריפט יציג לך ברירות מחדל (ניתן פשוט ללחוץ **Enter** על כל שאלה):
   - **ID**: המספר הפנוי הבא (למשל `150`)
   - **Hostname**: `kids-tasker`
   - **Disk**: `4G`
   - **RAM**: `512MB`
   - **Network**: `DHCP` על `vmbr0`
5. בסיום תקבל כתובת גישה:
   - 📱 **לוח משימות לטאבלט:** `http://<IP>:3000`
   - 👑 **לוח ניהול הורים:** `http://<IP>:3000/parent`

---

### שיטה 2: התקנה בתוך מיכל LXC או VM קיים (Debian / Ubuntu)

אם כבר יש לך קונטיינר LXC או מכונה וירטואלית קיימת:

1. היכנס לטרמינל של המיכל:
```bash
pct enter <CT_ID>
```
*(או באמצעות SSH לתוך ה-VM/LXC).*

2. הרץ את סקריפט ההתקנה:
```bash
curl -fsSL https://raw.githubusercontent.com/volski/kids-tasker/main/proxmox/setup-service.sh | bash
```

הסקריפט יתקין את Node.js 20, ישבט את הקוד ל-`/opt/kids-tasker`, יגדיר שירות systemd ויפעיל אותו אוטומטית בעליית המערכת.

---

### שיטה 3: הרצה באמצעות Docker / Docker Compose

אם יש לך מיכל Docker ייעודי או מכונת Portainer ב-Proxmox:

#### שימוש ב-Docker Compose:
1. צור תיקייה והורד את קובץ ה-compose:
```bash
mkdir -p /opt/kids-tasker && cd /opt/kids-tasker
curl -fsSL https://raw.githubusercontent.com/volski/kids-tasker/main/docker-compose.yml -o docker-compose.yml
```

2. הפעל את הקונטיינר ברקע:
```bash
docker compose up -d
```

#### או הרצה בפקודת `docker run` יחידה:
```bash
docker run -d \
  --name kids-tasker \
  --restart unless-stopped \
  -p 3000:3000 \
  -v kids-tasker-data:/app/data \
  ghcr.io/volski/kids-tasker:latest
```

---

## 🏠 חיבור ל-Home Assistant מתוך Proxmox

מכיוון ששרת Kids Tasker רץ כעת בתוך אותה רשת ביתית ב-Proxmox:

1. היכנס ללוח ההורים: `http://<IP_OR_HOSTNAME>:3000/parent`
2. עבור ללשונית **בית חכם (Home Assistant)**.
3. הזן את כתובת ה-Home Assistant המקומית שלך:
   - `http://homeassistant.local:8123` או כתובת ה-IP המקומית (למשל `http://192.168.1.100:8123`)
   - או הכתובת החיצונית שלך (`https://home.av-pro.co.il`)
4. הדבק את ה-**Long-Lived Access Token** שיצרת ב-Home Assistant.
5. הזן את ישות הטלוויזיה (למשל `switch.tv_socket`).
6. לחץ **שמור הגדרות** ולאחר מכן **בדוק חיבור 📡**.
   - החיבור מתבצע ישירות מהשרת (Node.js) ללא שום מגבלת דפדפן או שגיאות CORS!
7. לחץ **הוסף כרטיס ל-Home Assistant בלחיצה אחת ➕** להוספה ישירה של דשבורד Lovelace למערכת.

---

## ⚙️ ניהול שוטף וגיבויים ב-Proxmox

### פקודות שימושיות לשירות (במיכל LXC):
```bash
# בדיקת סטטוס השירות
systemctl status kids-tasker

# צפייה בלוגים חיים
journalctl -u kids-tasker -f

# הפעלה מחדש
systemctl restart kids-tasker
```

### עדכון גרסה עתידי:
```bash
cd /opt/kids-tasker
git pull
npm ci --omit=dev
systemctl restart kids-tasker
```

### מיקום קובץ הנתונים (לצורך גיבוי):
- במיכל LXC רגיל: `/opt/kids-tasker/data/tasks.json`
- ב-Docker: בווליום `kids-tasker-data` (נשמר גם בעת שדרוג תמונה).
- ב-Proxmox: מומלץ להפעיל גיבוי יומי אוטומטי של המיכל דרך **Proxmox Backup** או **Proxmox Backup Server (PBS)**.
