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

        // 테스트용 임베드 생성
        const embeds = [{
            title: `[${repoName}] 테스트 메시지`,
            description: `이것은 ${repoName} 레포지토리의 테스트 메시지입니다. 🧪`,
            color: 3447003, // 블루 색상
            author: {
                name: "테스트 사용자",
                icon_url: "https://github.com/identicons/app/png"
            }
        }];

        console.log(`Simulating webhook for repo: ${repoName}, thread: ${threadId}`);
        console.log(`Embeds:`, JSON.stringify(embeds, null, 2));

        // Discord로 임베드 메시지 전송
        await axios.post(`${DISCORD_WEBHOOK_URL}?thread_id=${threadId}`, {
            embeds: embeds
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

        // 임베드 메시지 생성
        const embeds = [];

        if (event === 'push') {
            const branch = payload.ref.replace('refs/heads/', '');
            const commitCount = payload.commits ? payload.commits.length : 0;
            const authorName = payload.pusher.name;
            const authorIcon = payload.sender?.avatar_url || `https://github.com/${authorName}.png`;

            // 임베드 헤더 필드 생성
            const title = `[${repoName}:${branch}] ${commitCount} new commit${commitCount !== 1 ? 's' : ''}`;
            const url = payload.compare;

            const embed = {
                title: title,
                url: url,
                color: 3447003, // 블루 색상
                author: {
                    name: authorName,
                    icon_url: authorIcon
                }
            };

            // 커밋 필드 추가
            if (payload.commits && payload.commits.length > 0) {
                embed.fields = [];

                payload.commits.slice(0, 5).forEach(commit => {
                    const shortHash = commit.id.substring(0, 7);
                    const message = commit.message.split('\n')[0]; // 첫 줄만 가져오기
                    const trimmedMessage = message.length > 60 ? message.substring(0, 57) + '...' : message;

                    embed.fields.push({
                        name: `${shortHash} ${trimmedMessage}`,
                        value: `${commit.author.name}`
                    });
                });

                if (payload.commits.length > 5) {
                    embed.fields.push({
                        name: `그 외 ${payload.commits.length - 5}개의 커밋`,
                        value: `[비교 보기](${payload.compare})`
                    });
                }
            }

            embeds.push(embed);
        } else if (event === 'pull_request') {
            const action = payload.action;
            const pr = payload.pull_request;

            let color;
            let actionText;
            switch (action) {
                case 'opened':
                    color = 5025616; // 녹색
                    actionText = '열림';
                    break;
                case 'closed':
                    color = pr.merged ? 10181046 : 15158332; // 병합됨(보라색), 닫힘(빨간색)
                    actionText = pr.merged ? '병합됨' : '닫힘';
                    break;
                default:
                    color = 3447003; // 기본 파란색
                    actionText = action;
            }

            embeds.push({
                title: `[${repoName}:PR #${pr.number}] ${pr.title}`,
                url: pr.html_url,
                color: color,
                author: {
                    name: pr.user.login,
                    icon_url: pr.user.avatar_url,
                    url: pr.user.html_url
                },
                description: pr.body ? (pr.body.length > 100 ? pr.body.substring(0, 97) + '...' : pr.body) : '',
                footer: {
                    text: actionText
                }
            });
        } else {
            // 기타 이벤트에 대한 기본 임베드
            embeds.push({
                title: `[${repoName}] ${event} 이벤트 발생`,
                color: 3447003,
                description: `GitHub에서 ${event} 이벤트가 발생했습니다.`
            });
        }

        // Discord 스레드로 임베드 메시지 전송
        await axios.post(`${DISCORD_WEBHOOK_URL}?thread_id=${threadId}`, {
            username: 'GitHub',
            avatar_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
            embeds: embeds
        });

        console.log(`Successfully sent message to Discord thread ${threadId}`);
        res.status(200).send('Webhook processed');
    } catch (error) {
        console.error('Error processing webhook:', error);
        console.error('Error details:', error.response ? error.response.data : 'No response data');
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
