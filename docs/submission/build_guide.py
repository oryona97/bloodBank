"""Build the Hebrew submission guide from the captured application screenshots.

Uses only the Python standard library. Run from any directory with Python 3.
The generated HTML embeds the images and can be opened without a running app.
"""

from base64 import b64encode
from html import escape
from pathlib import Path
import re
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
TITLE = 'מערכת BECS לניהול בנק דם'
SUBTITLE = 'הסבר הפתרון ותיעוד תרחישי שימוש'

sections = [
    ('מטרת המערכת והיקף הפתרון', [
        'המערכת מנהלת קליטה של תרומות דם וניפוק מנות בשגרה ובאירוע רב נפגעים. שלושת הממשקים מציגים מלאי משותף המתעדכן לאחר כל פעולה שהושלמה בהצלחה. מטרת התכנון היא לעמוד בכללי התאימות שבמטלה, להביא בחשבון את נדירות סוגי הדם ולשמור ככל האפשר מנות O- למצב חירום.',
        'המימוש נכתב ב-TypeScript. ממשק המשתמש נבנה ב-React וב-Vite, השרת ב-Node.js וב-Express, והנתונים נשמרים ב-PostgreSQL. המערכת פועלת בדפדפן על Windows; הוראות ההתקנה וההרצה נמצאות בקובץ README של הפרויקט.',
        'בהתאם להנחות המטלה, המערכת עוסקת בשמונת סוגי הדם המופיעים בטבלה שסופקה, בדם מלא בלבד וללא הגבלת משך אחסון. אין ניהול רכיבי דם או תאריכי תפוגה. כללי ההתאמה כאן הם מודל הלימוד שסופק במטלה, ולא פרוטוקול רפואי לשימוש קליני.',
    ]),
    ('סביבת ההדגמה', [
        'הצילומים נלקחו מהיישום הפועל ב-16 בספטמבר 2026, מול מסד נתונים נפרד בשם bloodbank_submission. השם ״תורם הדגמה״ והמספר 900001234 הם פרטי בדיקה מלאכותיים. מלאי העבודה הרגיל של הפרויקט לא שונה במסגרת הכנת צילומים אלה.',
        'התרחיש מתחיל ב-41 מנות: A+ עם 8 מנות, O+ עם 12, B+ עם 6, AB+ עם 3, A- עם 4, O- עם 5, B- עם 2 ו-AB- עם מנה אחת. כל הצילומים מתעדים את המשך אותו תרחיש, ולכן ניתן לעקוב אחר שינויי הכמויות ביניהם.',
    ]),
]

shots = [
    ('01-donation-form.png', 'קליטת תרומת דם',
     'במסך הקליטה מוזנים ארבעת השדות שנדרשו במטלה: סוג הדם, תאריך התרומה, מספר הזיהוי והשם המלא של התורם. בדוגמה נבחר A+ והוזנו פרטי תורם מלאכותיים. לפני השמירה המלאי הוא 41 מנות, מהן 8 מסוג A+.',
     'כל שליחה מוסיפה מנה אחת. השרת בודק את סוג הדם, את תקינות התאריך, שהתרומה אינה מתוארכת לעתיד, שם שאינו ריק ומספר זיהוי בן תשע ספרות. מספר הזיהוי נשמר כטקסט כדי לשמר אפסים בתחילתו; בדיקת ספרת ביקורת אינה ממומשת.'),
    ('02-donation-success.png', 'אישור קליטה ועדכון המלאי',
     'לאחר רישום התרומה מוצגת הודעת הצלחה. מלאי A+ עולה מ-8 ל-9, וסך המנות עולה מ-41 ל-42. גם רשימת הפעולות האחרונות מציגה את התרומה החדשה.',
     'פרטי התורם והתאריך נשמרים עם המנה במסד הנתונים. שינוי המלאי אינו רק שינוי חזותי במסך: המנה נשמרת וניתן להביא אותה בחשבון בבקשות ניפוק בהמשך.'),
    ('03-routine-recommendation.png', 'המלצה לניפוק בשגרה',
     'נדרשות 10 מנות עבור מקבל מסוג A+, אך קיימות רק 9 מנות A+. ההמלצה היא להשתמש תחילה ב-9 המנות מהסוג המדויק ולהשלים במנת O+ אחת, המתאימה לפי הטבלה שבמטלה.',
     'O+ נבחר לפני A- משום ששכיחותו בטבלה היא 32% לעומת 4%. O- נשמר בעדיפות לשעת חירום. זהו שלב תצוגה מקדימה בלבד: סך המלאי עדיין 42 מנות, ולמשתמש מוצעות פעולות אישור או ביטול.'),
    ('04-routine-success.png', 'ביצוע הניפוק בשגרה',
     'לאחר אישור הבקשה מוצגת הודעה על ניפוק 10 מנות. מלאי A+ יורד מ-9 לאפס, מלאי O+ יורד מ-12 ל-11, וסך המלאי יורד מ-42 ל-32. מלאי O- נשאר 5.',
     'בשרת מתבצעת בדיקה חוזרת של ההמלצה מול המלאי העדכני. רישום הניפוק ושינוי מצבן של המנות מתבצעים באותה עסקת מסד נתונים, כך שכשל באמצע הפעולה אינו משאיר ניפוק חלקי.'),
    ('05-insufficient-stock.png', 'טיפול במחסור במלאי מתאים',
     'בדוגמה נדרשות 1,000 מנות למקבל A+. נותרו רק 20 מנות מתאימות: 11 מסוג O+, ארבע מסוג A- וחמש מסוג O-. לכן מוצג חוסר של 980 מנות.',
     'סך המלאי הכללי הוא 32, אך סוגים שאינם מתאימים למקבל אינם נספרים כזמינים לבקשה זו. המערכת אינה מציעה אישור ניפוק כאשר אין די מנות מתאימות. המלאי נשאר 32; מדובר במדיניות שנבחרה למימוש: מילוי מלא של הבקשה או אי-ניפוק.'),
    ('06-emergency-confirmation.png', 'ניפוק בחירום',
     'במסך החירום מוצגות חמש מנות O- זמינות. המשתמש בוחר לשחרר את כל המנות ומקבל שלב אישור לפני הביצוע.',
     'פעולת החירום אינה מקבלת סוג דם אחר או כמות חלקית. בעת הביצוע השרת בודק מחדש כמה מנות O- זמינות ומנפק את כולן. מנות מסוגים אחרים נשארות במלאי.'),
    ('07-emergency-empty.png', 'סיום ניפוק החירום ומלאי ריק',
     'מוצגת הודעת הצלחה על ניפוק חמש מנות O-. המלאי של O- הוא כעת אפס וסך המנות ירד מ-32 ל-27. שאר סוגי הדם לא השתנו.',
     'המסך מציג הודעה שאין מנות O- זמינות וכפתור הניפוק אינו פעיל. גם פנייה ישירה לשרת כאשר המלאי ריק מחזירה שגיאה ואינה יוצרת רישום ניפוק חדש.'),
    ('08-exact-type-empty.png', 'חלופה כאשר הסוג המבוקש אזל לחלוטין',
     'בשלב האחרון נדרשות שתי מנות למקבל A+, כאשר מלאי A+ הוא אפס. המערכת ממליצה על שתי מנות O+ מתוך 11 המנות הזמינות מסוג זה.',
     'הצילום מדגים במפורש את הדרישה להציע סוג חלופי זמין כשהסוג המבוקש נגמר. ההמלצה לא אושרה במסגרת צילום זה, ולכן סך המלאי נשאר 27 מנות.'),
]

closing = [
    ('השלמות לפני הגשה לקורס', [
        'נותר לבדוק את הפתרון מול קובץ שקפי הקורס המעודכן, שטרם סופק, ולהשלים פרטי מגישים ומספרי סטודנט. התיעוד מתייחס למסמך מטלת BECS שנמסר; אין בו אישור לעמידה בדרישות נוספות שבשקפי הקורס.',
    ]),
    ('אסטרטגיית ההתאמה והנדירות', [
        'הבדיקה הראשונה היא תאימות: רק סוגי תורם המותרים למקבל לפי טבלת המטלה יכולים להיכלל בהמלצה. תחילה נבחרות מנות מהסוג המדויק המבוקש. אם הן אינן מספיקות, נבחנות החלופות המתאימות לפי שכיחותן באוכלוסייה, מהנפוצה לנדירה, כאשר O- הוא החלופה האחרונה.',
        'הנתונים שנלקחו מהמטלה הם A+ בשיעור 34%, O+ בשיעור 32%, B+ בשיעור 17%, AB+ בשיעור 7%, A- בשיעור 4%, O- בשיעור 3%, B- בשיעור 2% ו-AB- בשיעור 1%. אלה ערכי המטלה, ולא טענה לנתוני אוכלוסייה עדכניים.',
        'הבחירה לשמור O- לסוף רשימת החלופות נובעת מתפקידו בחירום. בתוך כל סוג דם נבחרות התרומות הישנות קודם. זהו כלל סדר עקבי, אף שאין במטלה הגבלת זמן אחסון.',
        'אם המלאי מהסוג המדויק אינו מספיק, ניתן לשלב כמה סוגים מתאימים באותה בקשה. כשסך המנות המתאימות אינו מספיק לבקשה כולה, לא מתבצע ניפוק. אלה החלטות תכנון מפורשות; המטלה אינה מכתיבה נוסחה יחידה לדירוג חלופות או מדיניות למילוי חלקי.',
    ]),
    ('תשובות לשאלות החשיבה על מצב חירום', [
        'למה O-? לפי טבלת ההתאמה במטלה, O- הוא סוג התורם היחיד שמותר לכל שמונת סוגי המקבלים. לכן, במודל המטלה, כאשר סוג הדם של המקבל אינו ידוע בזמן אירוע רב נפגעים, זהו הסוג שנבחר לניפוק החירום.',
        'מה המשמעות לניפוק בשגרה? שימוש שגרתי ב-O- מקטין את המלאי הזמין לחירום. לכן המערכת מעדיפה את הסוג המבוקש ואת החלופות המתאימות האחרות לפני שימוש ב-O-. אין חסימה מוחלטת של O- בשגרה: הוא עדיין משמש למקבלי O- או כשאין חלופה מתאימה אחרת.',
    ]),
    ('מבנה התוכנה ושמירת עקביות הנתונים', [
        'ממשק React מציג טפסים, מלאי ותוצאות. שרת Express מקבל בקשות HTTP, מאמת את הנתונים ומפעיל את כללי ההקצאה. PostgreSQL שומר את המנות, אירועי הניפוק והקישור בין כל מנה לאירוע שבו נופקה.',
        'לכל מנה מזהה ייחודי, סוג דם, תאריך תרומה, פרטי תורם ומצב: זמינה או מנופקת. המלאי מחושב מתוך המנות הזמינות, ולא מתוך מונה נפרד שעלול לצאת מסנכרון.',
        'פעולות שמשנות מלאי משתמשות בעסקה ובנעילה משותפת במסד הנתונים. כך בקשות מקבילות אינן יכולות לנפק אותה מנה פעמיים. מפתח בקשה ייחודי מאפשר לחזור על אותה בקשה אחרי ניתוק בלי לבצע שוב פעולה שכבר הושלמה.',
    ]),
    ('בדיקות ואימות', [
        'בבדיקת הפרויקט עברו 74 בדיקות לוגיקה ו-16 בדיקות אינטגרציה מול PostgreSQL. בדיקות הלוגיקה כוללות את כל 64 הצירופים של סוג תורם וסוג מקבל, סדרי עדיפות, שמירת O- ומקרי חוסר.',
        'בדיקות האינטגרציה מכסות שמירת תרומות, אימות קלט, ניפוק לפי סדר תרומות, מחסור, המלצה שהתיישנה, ניפוק חירום, בקשות מקבילות, מניעת פעולה כפולה וביטול עסקה שנכשלה. בדיקת TypeScript ובניית גרסת הייצור עברו אף הן. צילומי המסך משלימים את הבדיקות האוטומטיות בתיעוד פעולות בממשק.',
        'להרצה חוזרת: npm test לבדיקות הלוגיקה; npm run test:integration לבדיקות מסד הנתונים; npm run build לבדיקת הטיפוסים ולבנייה. בדיקות האינטגרציה דורשות מסד בדיקות נפרד, כמפורט ב-README.',
    ]),
]

rows = [
    ('מצב התחלתי', '8', '12', '5', '41'),
    ('לאחר קליטת תרומה', '9', '12', '5', '42'),
    ('לאחר ניפוק 10 מנות בשגרה', '0', '11', '5', '32'),
    ('לאחר בקשה עם חוסר', '0', '11', '5', '32'),
    ('לאחר ניפוק 5 מנות בחירום', '0', '11', '0', '27'),
    ('לאחר הצגת חלופה בלבד', '0', '11', '0', '27'),
]

def paragraph(text):
    content = re.sub(r'(?<![A-Za-z])(?:AB|A|B|O)[+-]', lambda m: '<bdi dir="ltr">' + m.group() + '</bdi>', escape(text))
    return '<p>' + content + '</p>'

parts = []
md = [f'# {TITLE}', '', f'## {SUBTITLE}', '']
for title, paragraphs in sections:
    parts.append('<section><h2>' + escape(title) + '</h2>' + ''.join(map(paragraph, paragraphs)) + '</section>')
    md.extend(['## ' + title, '', *[p + '\n' for p in paragraphs]])

nav = '<nav aria-label="ניווט לצילומי המסך">' + ''.join(f'<a href="#shot-{i}">{i:02d} · {escape(s[1])}</a>' for i, s in enumerate(shots, 1)) + '</nav>'
parts.append('<section><h2>תיעוד תרחישי השימוש</h2><p>כל צילום מציג מצב אמיתי של היישום. אפשר ללחוץ על התמונה כדי להגדיל אותה.</p>' + nav + '</section>')

for i, (name, title, context, explanation) in enumerate(shots, 1):
    image_path = ROOT / 'screenshots' / name
    if not image_path.is_file():
        raise FileNotFoundError(image_path)
    data = 'data:image/png;base64,' + b64encode(image_path.read_bytes()).decode('ascii')
    parts.append(f'<section class="scenario" id="shot-{i}"><div class="number">צילום {i:02d}</div><h2>{escape(title)}</h2>{paragraph(context)}{paragraph(explanation)}<figure><img src="{data}" alt="{escape(title)}" tabindex="0" onclick="openImage(this)" onkeydown="if(event.key===\'Enter\')openImage(this)"><figcaption>צילום {i:02d} · {escape(title)} · 16.09.2026</figcaption></figure></section>')
    md.extend([f'## צילום {i:02d} — {title}', '', context, '', explanation, '', f'![{title}](screenshots/{name})', ''])

table_head = ['שלב', 'A+', 'O+', 'O-', 'סך המנות']
table = '<table><thead><tr>' + ''.join('<th>'+escape(v)+'</th>' for v in table_head) + '</tr></thead><tbody>'
for row in rows:
    table += '<tr>' + ''.join('<td>'+escape(v)+'</td>' for v in row) + '</tr>'
table += '</tbody></table>'
parts.append('<section><h2>מעקב אחר המלאי בתרחיש</h2>' + table + '<p>שאר הסוגים נשארו ללא שינוי לאורך התרחיש: B+ עם 6 מנות, AB+ עם 3, A- עם 4, B- עם 2 ו-AB- עם מנה אחת.</p></section>')
md.extend(['## מעקב אחר המלאי בתרחיש', '', '| ' + ' | '.join(table_head) + ' |', '| --- | --- | --- | --- | --- |', *['| ' + ' | '.join(row) + ' |' for row in rows], ''])

for title, paragraphs in closing:
    parts.append('<section><h2>' + escape(title) + '</h2>' + ''.join(map(paragraph, paragraphs)) + '</section>')
    md.extend(['## ' + title, '', *[p + '\n' for p in paragraphs]])

css = '''
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Arial,"Segoe UI",sans-serif;background:#f3f5f2;color:#20362e;line-height:1.85}main{max-width:1120px;margin:36px auto;padding:0 28px 44px}header{padding:42px;background:#173f34;color:white;border-radius:14px;margin-bottom:24px}h1{font-size:36px;line-height:1.35;margin:8px 0 12px}header p{font-size:20px;margin:0;color:#dfeae3}.eyebrow{font-size:12px;letter-spacing:1px;color:#b9d0c2}section{background:white;border:1px solid #dfe5de;border-radius:12px;padding:28px 34px;margin:22px 0}h2{font-size:24px;line-height:1.5;margin:0 0 14px;color:#173f34}p{font-size:17px;margin:12px 0}nav{display:grid;grid-template-columns:1fr 1fr;gap:9px}nav a{color:#205f49;background:#eff5ee;padding:10px 14px;border-radius:7px;font-size:15px;text-decoration:none}.number{font-weight:bold;color:#8a5b40;font-size:13px;margin-bottom:6px}figure{margin:24px 0 0}figure img{display:block;width:100%;height:auto;border:1px solid #e1e6dc;border-radius:7px;cursor:zoom-in}figcaption{color:#617366;font-size:13px;margin-top:10px}table{border-collapse:collapse;width:100%;font-size:15px}th,td{padding:12px;border:1px solid #d9e1d7;text-align:right}th{background:#edf3e9}td:not(:first-child),th:not(:first-child){direction:ltr;text-align:center}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:20px}.toolbar button{background:#fff;border:0;border-radius:6px;padding:10px 18px;font:inherit;cursor:pointer;color:#173f34}.toolbar small{color:#c4d9cb}footer{font-size:13px;color:#728174;text-align:center;padding:16px}dialog{max-width:96vw;max-height:96vh;padding:16px;border:0;border-radius:8px}dialog::backdrop{background:#000a}dialog img{display:block;max-width:none;width:auto;height:auto}dialog button{position:sticky;top:0;padding:8px 20px;font:inherit;cursor:pointer}body:has(dialog[open]){overflow:hidden}@media(max-width:650px){main{padding:0 12px;margin:12px auto}header{padding:28px}h1{font-size:28px}section{padding:22px 18px}h2{font-size:21px}p{font-size:16px}nav{grid-template-columns:1fr}}@page{size:A4 portrait;margin:15mm}@media print{body{background:white;color:#111}main{max-width:none;margin:0;padding:0}header{background:none;color:#111;padding:0;border-radius:0}header p,.eyebrow{color:#333}.toolbar,nav,dialog{display:none}section{border:0;padding:0;margin:18px 0;border-radius:0}h2{color:#111;break-after:avoid}p{font-size:11pt;line-height:1.6}.scenario{break-before:page}figure{break-before:page;break-inside:avoid;margin:0}figure img{width:auto;max-width:100%;max-height:240mm;margin:auto;object-fit:contain}figcaption{font-size:9pt;text-align:center}table{font-size:10pt}th,td{padding:7px}}
'''
html = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+TITLE+' — '+SUBTITLE+'</title><style>'+css+'</style></head><body><main><header><div class="eyebrow">BECS · BLOOD BANK · 16.09.2026</div><h1>'+TITLE+'</h1><p>'+SUBTITLE+'</p><div class="toolbar"><button onclick="window.print()">הדפסה או שמירה כ־PDF</button><small>המסמך כולל את התמונות ופועל גם ללא חיבור לשרת</small></div></header>'+''.join(parts)+'<footer>מקור הדרישות והטבלאות: מסמך משימת BECS שסופק בקורס · מאגר הפרויקט: github.com/oryona97/bloodBank</footer></main><dialog id="viewer"><button onclick="document.getElementById(\'viewer\').close()">סגירה</button><img id="large-image" alt=""></dialog><script>function openImage(image){const target=document.getElementById("large-image");target.src=image.src;target.alt=image.alt;document.getElementById("viewer").showModal()}</script></body></html>'
(ROOT / 'guide.he.html').write_text(html, encoding='utf-8')
(ROOT / 'explanations.he.md').write_text('\n'.join(md), encoding='utf-8')

archive = ROOT.parent / 'BECS-submission.zip'
with ZipFile(archive, 'w', ZIP_DEFLATED) as z:
    for path in sorted(ROOT.rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:
            z.write(path, Path('BECS-submission') / path.relative_to(ROOT))
print('Generated Hebrew HTML, Markdown, and submission ZIP with 8 screenshots.')
