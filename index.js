require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// 각 레포지토리별 스레드 ID 매핑
const REPO_THREAD_MAPPING = {
    'ollim-web': process.env.OLLIM_WEB_THREAD_ID,
    'ollim-app': process.env.OLLIM_APP_THREAD_ID,
    'default': process.env.OLLIM_WEB_THREAD_ID
};

// 기본 경로 - 서버 상태 확인용
app.get('/', (req, res) => {
    res.status(200).send('GitHub to Discord webhook relay server is running!');
});

// 테스트 엔드포인트
app.get('/test', (req, res) => {
    res.status(200).send('Test endpoint working!');
});

// 테스트용 웹훅 시뮬레이션
app.get('/simulate-webhook', async (req, res) => {
    try {
        const repoName = req.query.repo || 'ollim-web';
        const threadId = REPO_THREAD_MAPPING[repoName] || REPO_THREAD_MAPPING['default'];

        const message = `[${repoName}] **테스트 메시지** 🧪\n이것은 ${repoName} 레포지토리의 테스트 메시지입니다.`;

        console.log(`Simulating webhook for repo: ${repoName}, thread: ${threadId}`);
        console.log(`Message: ${message}`);

        // Discord로 메시지 전송
        await axios.post(`${DISCORD_WEBHOOK_URL}?thread_id=${threadId}`, {
            content: message
        });

        res.status(200).send(`Test message sent to Discord thread for repo: ${repoName}`);
    } catch (error) {
        console.error('Error in webhook simulation:', error);
        res.status(500).send(`Error: ${error.message}`);
    }
});

// GitHub 웹훅 처리
app.post('/github-webhook', async (req, res) => {
    try {
        console.log('Received webhook request');
        console.log('Headers:', JSON.stringify(req.headers, null, 2));

        const event = req.headers['x-github-event'];
        if (!event) {
            console.error('Missing x-github-event header');
            return res.status(400).send('Missing x-github-event header');
        }

        const payload = req.body;
        if (!payload || !payload.repository) {
            console.error('Invalid payload structure:', payload);
            return res.status(400).send('Invalid payload structure');
        }

        // 레포지토리 이름 추출
        const repoName = payload.repository.name;
        console.log(`Received ${event} event from repository: ${repoName}`);

        // 레포지토리에 해당하는 스레드 ID 찾기
        const threadId = REPO_THREAD_MAPPING[repoName] || REPO_THREAD_MAPPING['default'];

        // 이벤트 타입에 따른 메시지 생성
        let message = `[${repoName}] `;

        if (event === 'push') {
            const branch = payload.ref.replace('refs/heads/', '');
            message += `**브랜치 \`${branch}\`에 새 푸시** 🚀\n`;

            if (payload.commits && payload.commits.length > 0) {
                message += '\n**커밋:**\n';
                payload.commits.slice(0, 5).forEach(commit => {
                    message += `- ${commit.message} (${commit.author.name})\n`;
                });

                if (payload.commits.length > 5) {
                    message += `\n... 그 외 ${payload.commits.length - 5}개 커밋\n`;
                }
            }

            message += `\n${payload.compare}`;
        } else if (event === 'pull_request') {
            const action = payload.action;
            const pr = payload.pull_request;

            message += `**PR #${pr.number} ${action}됨** 📌\n`;
            message += `${pr.title}\n`;
            message += `작성자: ${pr.user.login}\n`;
            message += `${pr.html_url}`;
        } else {
            message += `GitHub ${event} 이벤트 발생`;
        }

        // Discord 스레드로 메시지 전송
        await axios.post(`${DISCORD_WEBHOOK_URL}?thread_id=${threadId}`, {
            content: message
        });

        console.log(`Successfully sent message to Discord thread ${threadId}`);
        res.status(200).send('Webhook processed');
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).send('Error processing webhook');
    }
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`Webhook relay server running on port ${PORT}`);
    console.log('Environment variables check:');
    console.log('DISCORD_WEBHOOK_URL:', DISCORD_WEBHOOK_URL ? 'Set ✓' : 'Not set ✗');
    console.log('OLLIM_WEB_THREAD_ID:', process.env.OLLIM_WEB_THREAD_ID ? 'Set ✓' : 'Not set ✗');
    console.log('OLLIM_APP_THREAD_ID:', process.env.OLLIM_APP_THREAD_ID ? 'Set ✓' : 'Not set ✗');
});
