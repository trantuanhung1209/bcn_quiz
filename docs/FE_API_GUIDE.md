# FE API Guide

Tai lieu nay tong hop toan bo API hien co de frontend tich hop nhanh.

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

## 2) Authentication

### Public APIs

1. `POST /auth/login`
2. `POST /auth/2fa/verify/totp`
3. `POST /auth/refresh`
4. `POST /auth/logout`

### Protected APIs

Tat ca API con lai yeu cau xac thuc (Bearer token hoac cookie token).

Header khuyen nghi:

```http
Authorization: Bearer <access_token>
```

### Get current user

- `GET /auth/me`

### Logout

- `POST /auth/logout`

Body:

```json
{}
```

Frontend nen goi endpoint nay truoc khi xoa token local de backend/upstream clear session-cookie dong bo.

## 3) Topic APIs

### 3.1 Get topic list

- `GET /topic?page=1&limit=10`

### 3.2 Get topic by id

- `GET /topic/:id`

### 3.3 Get topic by slug

- `GET /topic/slug/:slug`

### 3.4 Create topic

- `POST /topic`

Body:

```json
{
  "name": "C Basic Flow Test",
  "slug": "c-basic-flow-test"
}
```

### 3.5 Update topic

- `PUT /topic/:id`

Body (optional fields):

```json
{
  "name": "C Basic",
  "slug": "c-basic"
}
```

### 3.6 Delete topic

- `DELETE /topic/:id`

### 3.7 Get quizzes in topic

1. `GET /topic/:id/quizzes?page=1&limit=10`
2. `GET /topic/slug/:slug/quizzes?page=1&limit=10`

## 4) Quiz APIs

### 4.1 Get quiz list

- `GET /quiz?page=1&limit=10`

### 4.2 Get quiz by id

- `GET /quiz/:id`

### 4.3 Get quiz by code

- `GET /quiz/code/:code`

### 4.4 Create quiz

- `POST /quiz`

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

### 4.5 Update quiz

- `PUT /quiz/:id`

Body dang dung giong create (tru quizCode hien tai khong update tren service):

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

### 4.6 Delete quiz

- `DELETE /quiz/:id`

## 5) Attempt + Session APIs

## 5.1 Session flow (khuyen nghi cho thi theo topic)

### Start session

- `POST /topic/:topicId/session/start`

Body (optional):

```json
{
  "expiresInMinutes": 30
}
```

Range hop le: `5` -> `240`.

### Resume session

- `GET /topic/:topicId/session/resume`

Tra `null` neu khong co session dang lam hoac session da het han.

### Save progress (autosave)

- `POST /attempt/session/:sessionId/save`

Body goi y (gon):

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

### Submit session

- `POST /attempt/session/:sessionId/submit`

Body: none

Data tra ve:

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

## 5.2 Single quiz submit (khong theo session)

- `POST /quiz/:id/attempt`

Body:

```json
{
  "selectedAnswer": "2",
  "startedAt": "2026-04-02T13:30:00.000Z"
}
```

## 5.3 Attempt history

### List my attempts

- `GET /attempt/me?page=1&limit=10`
- Optional filters:
  - `topicId`
  - `quizId`

### Get attempt detail

- `GET /attempt/me/:attemptId`

## 6) Progress APIs

### 6.1 Global progress

- `GET /progress/me`

Tra tong quan tat ca topic:
- `totalAttempts`
- `correctAttempts`
- `accuracy`
- `byTopic`

### 6.2 Topic progress detail

- `GET /progress/me/topic/:topicId`

Tra thong ke chi tiet topic:
- `summary.totalQuizCount`
- `summary.attemptedQuizCount`
- `summary.unansweredQuizCount`
- `summary.correctQuizCount`
- `summary.wrongQuizCount`
- `summary.completionRate`
- `summary.accuracyByQuiz`
- `quizStats[]` (chi tiet tung quiz: answered, selectedAnswer, correctAnswer, isCorrect)
- `recentAttempts[]`

## 7) Session Expiration

- Co cron job chay moi 5 phut.
- Session `IN_PROGRESS` qua `expiresAt` se duoc chuyen thanh `EXPIRED`.

## 8) Common Error Cases

1. `400 Bad Request`
- Sai DTO
- Gui field du
- `selectedAnswer` co ma khong co `currentQuizId`

2. `401/403`
- Thieu token
- Token khong hop le
- User truy cap attempt/session khong phai cua minh

3. `404 Not Found`
- Topic/Quiz/Session/Attempt khong ton tai

4. `409 Conflict`
- Tao quiz trung `quizCode`
- Tao topic trung `slug`

## 9) FE Integration Flow (Recommended)

1. Login -> lay access token.
2. Lay topics: `GET /topic`.
3. User chon topic -> `POST /topic/:topicId/session/start`.
4. Lay quiz trong topic: `GET /topic/:topicId/quizzes`.
5. Moi lan user chon dap an -> `POST /attempt/session/:sessionId/save`.
6. User quay lai app -> `GET /topic/:topicId/session/resume`.
7. Nop bai -> `POST /attempt/session/:sessionId/submit`.
8. Hien thi ket qua topic -> `GET /progress/me/topic/:topicId`.
9. Hien thi dashboard tong -> `GET /progress/me`.
