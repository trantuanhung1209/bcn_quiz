# FE API Guide

Tai lieu nay tong hop toan bo API hien co de frontend tich hop nhanh.

> **Last updated:** June 2026 — Them topic image upload (Cloudinary signed upload).

---

## 1) Base Information

- Base URL (dev): `http://localhost:3000`
- Tat ca response thanh cong duoc wrap theo format:

```json
{
  "statusCode": 200,
  "message": "Success",
  "data": {}
}
```

- Validation dang bat:
  - `whitelist: true`
  - `forbidNonWhitelisted: true`
  - Neu gui field la se bi `400 Bad Request`.

- Pagination response chung:

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10,
    "hasNext": true,
    "hasPrevious": false
  }
}
```

---

## 2) Authentication

### ⚡ Security Notes

1. **Rate Limiting**
   - Cac API Auth nhay cam (`/auth/login`, `/auth/refresh`, `/auth/2fa/...`) gioi han toi da **5 requests / 1 phut** tren moi IP.
   - Vuot gioi han -> HTTP `429 Too Many Requests`. FE hien thong bao "Vui long thao tac cham lai".
   - Cac API con lai gioi han chung **100 requests / 1 phut**.

2. **Refresh Token Flow**
   - Goi `/auth/refresh` khong co `authorization` header hoac cookie `refresh` -> `401` voi detail code `MISSING_REFRESH_TOKEN`.
   - Co refresh token nhung het han / khong hop le -> `401` voi detail code `INVALID_REFRESH_TOKEN`.
   - FE dung 2 ma loi nay de buoc user logout hoac chuyen ve `/login`.

3. **Hieu suat**
   - Toan bo JSON response tu dong nen `gzip`. FE khong can config them.

### Public APIs

| Method | Endpoint | Ghi chu |
|--------|----------|---------|
| `POST` | `/auth/login` | |
| `POST` | `/auth/2fa/verify/totp` | |
| `POST` | `/auth/2fa/verify/email` | Body: `{ "code": "123456" }` |
| `POST` | `/auth/2fa/send-email-otp` | Body (optional): `{ "email": "user@example.com" }` — goi truoc khi verify email OTP |
| `POST` | `/auth/refresh` | |
| `POST` | `/auth/logout` | Body: `{}` |

### Protected APIs

Tat ca API con lai yeu cau xac thuc.

```http
Authorization: Bearer <access_token>
```

### Get current user

`GET /auth/me`

### Logout

`POST /auth/logout` — Body: `{}`

FE nen goi truoc khi xoa token local de backend clear session-cookie dong bo.

---

## 3) Topic APIs

> **[Admin]** = chi admin moi goi duoc (Bearer token voi role `admin`).

### 3.1 Get topic list

`GET /topic?page=1&limit=10`

Response `data.items[]`:

```json
{
  "id": "...",
  "name": "JavaScript Basics",
  "slug": "javascript-basics",
  "imageUrl": "https://res.cloudinary.com/...",
  "imagePublicId": "topic-images/javascript-basics",
  "createdAt": "...",
  "_count": { "quizzes": 10 }
}
```

`imageUrl` va `imagePublicId` co the la `null` neu topic chua co anh.

### 3.2 Get topic by id

`GET /topic/:id`

### 3.3 Get topic by slug

`GET /topic/slug/:slug`

### 3.4 Get quizzes in topic

1. `GET /topic/:id/quizzes?page=1&limit=10`
2. `GET /topic/slug/:slug/quizzes?page=1&limit=10`

### 3.5 Create topic — [Admin]

`POST /topic`

Body:

```json
{
  "name": "JavaScript Basics",
  "slug": "javascript-basics",
  "courseId": "<course_id>",
  "imageUrl": "https://res.cloudinary.com/...",
  "imagePublicId": "topic-images/javascript-basics"
}
```

Luu y:
- `courseId` bat buoc.
- `slug` chi can unique trong cung mot course, co the trung giua cac course khac.
- `imageUrl` va `imagePublicId` la optional, nhung neu gui phai gui **ca hai** cung luc. Gui mot trong hai -> `400`.
- `imageUrl` phai la HTTPS URL thuoc `res.cloudinary.com` va dung cloud name.
- Lay `imageUrl` + `imagePublicId` bang cach upload anh truoc qua endpoint `POST /topic/upload/signature` (xem muc 3.8).

### 3.6 Update topic — [Admin]

`PUT /topic/:id`

Body (tat ca optional):

```json
{
  "name": "JavaScript Basics v2",
  "slug": "javascript-basics-v2",
  "imageUrl": "https://res.cloudinary.com/...",
  "imagePublicId": "topic-images/javascript-basics-v2"
}
```

Luu y:
- Khi cap nhat `imageUrl` + `imagePublicId` moi, anh cu tren Cloudinary se tu dong bi **xoa** neu `imagePublicId` khac.
- De xoa anh cua topic: gui `imageUrl: null, imagePublicId: null` — **khong ho tro hien tai**, chi update bang anh moi.

### 3.7 Delete topic — [Admin]

`DELETE /topic/:id`

- Xoa topic se tu dong xoa anh tren Cloudinary kem theo.

### 3.8 Upload topic image signature — [Admin]

`POST /topic/upload/signature`

Lay signature de FE upload anh truc tiep len Cloudinary (khong qua server).

Body (optional):

```json
{
  "publicId": "javascript-basics"
}
```

- `publicId`: ten file muon dat tren Cloudinary. De trong de Cloudinary tu sinh.

Response `data`:

```json
{
  "signature": "abc123...",
  "timestamp": 1718000000,
  "folder": "topic-images",
  "apiKey": "your_api_key",
  "cloudName": "your_cloud",
  "resourceType": "auto",
  "uploadUrl": "https://api.cloudinary.com/v1_1/your_cloud/auto/upload"
}
```

**Flow upload anh cho topic (3 buoc):**

```
1. POST /topic/upload/signature  →  nhan signature
2. FE upload anh truc tiep len Cloudinary (multipart/form-data)
3. POST /topic hoac PUT /topic/:id  voi { imageUrl, imagePublicId }
```

**TypeScript snippet:**

```ts
type UploadSignatureResponse = {
  signature: string;
  timestamp: number;
  folder: string;
  apiKey: string;
  cloudName: string;
  resourceType: 'auto';
  uploadUrl: string;
};

async function getTopicImageSignature(publicId?: string): Promise<UploadSignatureResponse> {
  const res = await fetch('/topic/upload/signature', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(publicId ? { publicId } : {}),
  });
  if (!res.ok) throw new Error('Cannot get signature');
  const payload = await res.json();
  return payload.data;
}

async function uploadTopicImage(file: File, sig: UploadSignatureResponse, publicId?: string) {
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('signature', sig.signature);
  form.append('folder', sig.folder);
  form.append('resource_type', sig.resourceType);
  if (publicId) form.append('public_id', publicId);

  const res = await fetch(sig.uploadUrl, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Cloudinary upload failed');
  const result = await res.json();

  return {
    imageUrl: result.secure_url as string,
    imagePublicId: result.public_id as string,
  };
}

// Usage:
async function createTopicWithImage(file: File, topicData: { name: string; slug: string; courseId: string }) {
  const publicId = file.name.replace(/\.[^.]+$/, '');
  const sig = await getTopicImageSignature(publicId);
  const { imageUrl, imagePublicId } = await uploadTopicImage(file, sig, publicId);

  const res = await fetch('/topic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ ...topicData, imageUrl, imagePublicId }),
  });
  return res.json();
}
```

---

## 4) Quiz APIs

> **[Admin]** = chi admin moi goi duoc.

### 4.1 Get quiz list

`GET /quiz?page=1&limit=10`

### 4.2 Get quiz by id

`GET /quiz/:id`

### 4.3 Get quiz by code

`GET /quiz/code/:code`

Luu y: `quizCode` chi unique trong 1 topic, endpoint nay tra quiz moi nhat theo `quizCode`.

### 4.4 Create quiz — [Admin]

`POST /quiz`

Body:

```json
{
  "quizCode": "c_case_01",
  "question": "Ket qua xuat ra cua doan code sau la gi?",
  "code": "#include <stdio.h>\\nvoid main() { ... }",
  "answer": "2",
  "explanation": "Day la toan tu tam nguyen...",
  "topicId": "<topic_id>",
  "options": [
    { "label": "1", "content": "10", "isCode": false },
    { "label": "2", "content": "20", "isCode": false },
    { "label": "3", "content": "30", "isCode": false },
    { "label": "4", "content": "Loi cu phap", "isCode": false }
  ]
}
```

### 4.5 Update quiz — [Admin]

`PUT /quiz/:id`

Body giong create:

```json
{
  "quizCode": "c_case_01",
  "question": "Noi dung moi",
  "code": "",
  "answer": "2",
  "explanation": "...",
  "topicId": "<topic_id>",
  "options": [
    { "label": "1", "content": "A", "isCode": false },
    { "label": "2", "content": "B", "isCode": false }
  ]
}
```

### 4.6 Delete quiz — [Admin]

`DELETE /quiz/:id`

---

## 5) Attempt + Session APIs

### 5.1 Session flow (khuyen nghi cho thi theo topic)

#### Start session

`POST /topic/:topicId/session/start`

Body (optional):

```json
{
  "expiresInMinutes": 30
}
```

Range hop le: `5` → `240`.

#### Resume session

`GET /topic/:topicId/session/resume`

Tra `null` neu khong co session dang lam hoac session da het han.

#### Save progress (autosave)

`POST /attempt/session/:sessionId/save`

Body gon (khuyen nghi):

```json
{
  "currentQuizId": "<quiz_id>",
  "selectedAnswer": "2"
}
```

Body tuong thich nguoc (batch map):

```json
{
  "currentQuizId": "<quiz_id>",
  "answers": {
    "<quiz_id>": "2"
  }
}
```

Luu y:
- Neu gui `selectedAnswer` thi phai co `currentQuizId`.
- Moi lan save se gia han session them 30 phut.

#### Submit session

`POST /attempt/session/:sessionId/submit`

Body: none

Response `data`:

```json
{
  "sessionId": "...",
  "topicId": "...",
  "attemptedQuizCount": 5,
  "correctCount": 4,
  "score": 0.8,
  "submittedAt": "2026-04-02T07:00:00.000Z"
}
```

### 5.2 Single quiz submit (khong theo session)

`POST /quiz/:id/attempt`

Body:

```json
{
  "selectedAnswer": "2",
  "startedAt": "2026-04-02T13:30:00.000Z"
}
```

### 5.3 Attempt history

**List my attempts:** `GET /attempt/me?page=1&limit=10`

Optional filters: `topicId`, `quizId`.

**Get attempt detail:** `GET /attempt/me/:attemptId`

---

## 6) Progress APIs

### 6.1 Global progress

`GET /progress/me`

Tra tong quan tat ca topic: `totalAttempts`, `correctAttempts`, `accuracy`, `byTopic`.

### 6.2 Topic progress detail

`GET /progress/me/topic/:topicId`

Tra thong ke chi tiet:
- `summary.totalQuizCount`
- `summary.attemptedQuizCount`
- `summary.unansweredQuizCount`
- `summary.correctQuizCount`
- `summary.wrongQuizCount`
- `summary.completionRate`
- `summary.accuracyByQuiz`
- `quizStats[]` — chi tiet tung quiz: `answered`, `selectedAnswer`, `correctAnswer`, `isCorrect`
- `recentAttempts[]`

---

## 7) Course APIs

Rule hoan thanh course:
- Hoan thanh tat ca topic (moi topic >= 80%) → 50% tien do khoa hoc.
- Neu course co project requirement: chi khi admin duyet project moi len 100% va cap chung chi.
- Neu course khong co project requirement: hoan thanh tat ca topic se len 100%.

### 7.1 Learner APIs

| Method | Endpoint | Ghi chu |
|--------|----------|---------|
| `GET` | `/course?page=1&limit=10` | |
| `GET` | `/course/slug/:slug` | |
| `GET` | `/course/:id` | |
| `GET` | `/course/:id/topics?page=1&limit=10` | |
| `GET` | `/course/:id/progress/me` | |
| `GET` | `/course/:id/project-submission/me` | |
| `POST` | `/course/:id/upload/signature` | Lay signature upload Cloudinary |
| `POST` | `/course/:id/project-submission` | Submit metadata file |
| `PATCH` | `/course/:id/project-submission/:submissionId` | Cap nhat submission |
| `DELETE` | `/course/:id/project-submission/:submissionId` | Xoa submission |

Upload project su dung direct upload Cloudinary:
- Cho phep: `.zip`, `.rar`, `.pdf`, `.docx`
- Toi da 5 file, moi file toi da 20 MB

**Flow upload project (4 buoc):**

```
1. POST /course/:id/upload/signature  →  nhan signature
2. FE upload file truc tiep len Cloudinary
3. Cloudinary tra ve secure_url + public_id
4. POST /course/:id/project-submission  voi metadata file
```

**Luu y quan trong:**
- Moi user chi co 1 submission cho moi course. Neu da submit, dung `PATCH` de cap nhat.
- Response submission tra ve `files: string[]` (danh sach URL file).

Body `POST /course/:id/upload/signature`:

```json
{
  "publicId": "my_project_v2"
}
```

Response `data`:

```json
{
  "signature": "cd35bf0407a178577c157ec54fbb9cb3875fd75e",
  "timestamp": 1775883082,
  "folder": "project-submissions/<courseId>/<userId>",
  "apiKey": "223812375436597",
  "cloudName": "dav7n3cu7",
  "resourceType": "auto",
  "uploadUrl": "https://api.cloudinary.com/v1_1/dav7n3cu7/auto/upload"
}
```

Body `POST /course/:id/project-submission`:

```json
{
  "note": "Em nop bai lan dau",
  "files": [
    {
      "secureUrl": "https://res.cloudinary.com/<cloud>/raw/upload/v123/project-submissions/<courseId>/<userId>/my_project_v2.zip",
      "publicId": "project-submissions/<courseId>/<userId>/my_project_v2",
      "originalName": "my_project_v2.zip",
      "mimeType": "application/zip",
      "fileSize": 1048576
    }
  ]
}
```

Body `PATCH /course/:id/project-submission/:submissionId`:

```json
{
  "note": "Em cap nhat ban moi",
  "removeFiles": [
    "https://res.cloudinary.com/<cloud>/raw/upload/v123/.../old-file.pdf"
  ],
  "files": [
    {
      "secureUrl": "https://res.cloudinary.com/<cloud>/raw/upload/v124/.../new-file.zip",
      "publicId": "project-submissions/<courseId>/<userId>/new-file",
      "originalName": "new-file.zip",
      "mimeType": "application/zip",
      "fileSize": 2097152
    }
  ]
}
```

Rule `PATCH`:
- Mac dinh giu nguyen tat ca file cu neu khong truyen `removeFiles`.
- `removeFiles`: danh sach URL file cu can xoa.
- `files`: metadata file moi da upload len Cloudinary.
- Co the vua xoa file cu, vua them file moi trong cung 1 request.
- Tong so file sau cung phai nam trong khoang `1 → 5`.

**TypeScript snippet (course project upload):**

```ts
type UploadSignatureResponse = {
  signature: string;
  timestamp: number;
  folder: string;
  apiKey: string;
  cloudName: string;
  resourceType: 'auto';
  uploadUrl: string;
};

type UploadedCloudinaryFile = {
  secureUrl: string;
  publicId: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
};

async function getUploadSignature(courseId: string, publicId?: string): Promise<UploadSignatureResponse> {
  const res = await fetch(`/course/${courseId}/upload/signature`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(publicId ? { publicId } : {}),
  });
  if (!res.ok) throw new Error('Cannot get Cloudinary signature');
  const payload = await res.json();
  return payload.data;
}

async function uploadFileToCloudinary(
  file: File,
  sig: UploadSignatureResponse,
  publicId: string,
): Promise<UploadedCloudinaryFile> {
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('signature', sig.signature);
  form.append('folder', sig.folder);
  form.append('resource_type', sig.resourceType);
  form.append('public_id', publicId);

  const uploadUrl = sig.uploadUrl ?? `https://api.cloudinary.com/v1_1/${sig.cloudName}/auto/upload`;
  const res = await fetch(uploadUrl, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload to Cloudinary failed');
  const result = await res.json();

  return {
    secureUrl: result.secure_url,
    publicId: result.public_id,
    originalName: file.name,
    mimeType: file.type,
    fileSize: file.size,
  };
}

// Usage
async function handleProjectUpload(courseId: string, file: File) {
  const publicId = file.name.replace(/\.[^.]+$/, '');
  const sig = await getUploadSignature(courseId, publicId);
  return uploadFileToCloudinary(file, sig, publicId);
}
```

### 7.2 Admin APIs

| Method | Endpoint | Ghi chu |
|--------|----------|---------|
| `POST` | `/course` | Tao course |
| `PUT` | `/course/:id` | Cap nhat course |
| `DELETE` | `/course/:id` | Xoa course |
| `PUT` | `/course/:id/topics` | Cap nhat danh sach topic |
| `PUT` | `/course/:id/project-requirement` | Upsert de bai project |
| `GET` | `/course/:id/project-submission?status=...` | Xem tat ca submission |
| `PATCH` | `/course/:id/project-submission/:submissionId/review` | Duyet bai nop |

Luu y `PUT /course/:id/project-requirement`:
- `description` bat buoc, khong duoc de trong.

Body `PATCH .../review`:

```json
{
  "decision": "APPROVE",
  "reviewerNote": "Good architecture and documentation"
}
```

`decision` ho tro: `APPROVE`, `REJECT`.

### 7.3 Certificate APIs

`GET /certificate/me`

Chi tra ve chung chi sau khi course dat 100%.

---

## 8) Session Expiration

- Cron job chay moi 5 phut.
- Session `IN_PROGRESS` qua `expiresAt` chuyen thanh `EXPIRED`.

---

## 9) Common Error Cases

| Code | Nguyen nhan |
|------|-------------|
| `400` | Sai DTO, gui field du, `selectedAnswer` khong co `currentQuizId`, `imageUrl` co nhung thieu `imagePublicId` (hoac nguoc lai), project submission het file sau update, submission vuot qua 5 file |
| `401/403` | Thieu token, token het han, user truy cap resource khong phai cua minh |
| `404` | Topic / Quiz / Session / Attempt / Course khong ton tai |
| `409` | `quizCode` trung trong cung topic, `slug` trung trong cung course, user submit project lan 2 |
| `429` | Vuot rate limit (5 req/phut voi auth API, 100 req/phut chung) |

---

## 10) FE Integration Flow (Recommended)

### Course + Project flow

1. Login → lay access token.
2. Lay danh sach courses: `GET /course`.
3. Lay danh sach topics: `GET /topic` hoac `GET /course/:id/topics`.
4. Trong qua trinh hoc, theo doi tien do:
   - `GET /course/:id/progress/me`
   - `GET /progress/me/topic/:topicId`
5. Khi tat ca topic dat >= 80% → UI hien thi 50% course progress.
6. User nop project: `POST /course/:id/project-submission`.
7. Neu can cap nhat bai nop: `PATCH /course/:id/project-submission/:submissionId`.
8. Sau khi admin approve → refresh `GET /course/:id/progress/me` de thay 100%.
9. Lay chung chi: `GET /certificate/me`.

> **Luu y:** Khi khoa hoc dat 100% va chung chi duoc cap, backend tu dong ban event `COURSE_COMPLETE` sang he thong Profiles de cap nhat Timeline.

### Topic quiz session flow

1. User chon topic → `POST /topic/:topicId/session/start`.
2. Lay danh sach quiz → `GET /topic/:topicId/quizzes`.
3. Moi lan user chon dap an → `POST /attempt/session/:sessionId/save`.
4. User quay lai app → `GET /topic/:topicId/session/resume`.
5. Nop bai → `POST /attempt/session/:sessionId/submit`.
6. Hien thi ket qua topic → `GET /progress/me/topic/:topicId`.
7. Hien thi dashboard tong → `GET /progress/me`.

### Topic image upload flow (admin)

1. Admin chon anh cho topic.
2. Lay signature: `POST /topic/upload/signature` (voi Bearer admin token).
3. Upload anh truc tiep len Cloudinary.
4. Lay `imageUrl` + `imagePublicId` tu Cloudinary response.
5. Gui cung voi topic data khi tao (`POST /topic`) hoac cap nhat (`PUT /topic/:id`).
