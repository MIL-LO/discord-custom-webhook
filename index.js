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

// 중복 요청 방지를 위한 처리된 이벤트 ID 캐시
const processedEvents = new Set();
// 캐시 크기 제한
const MAX_CACHE_SIZE = 100;

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

        // 테스트용 사용자 정보
        const username = "9bfish8";
        const avatarUrl = "https://github.com/9bfish8.png";

        // GitHub 스타일 임베드 생성
        const embeds = [{
            color: 3447003, // GitHub 파란색
            title: `[${repoName}] 테스트 메시지`,
            description: `이것은 ${repoName} 레포지토리의 테스트 메시지입니다. 🧪`
        }];

        console.log(`Simulating webhook for repo: ${repoName}, thread: ${threadId}`);

        // Discord로 메시지 전송 - 사용자 정보 포함
        await axios.post(`${DISCORD_WEBHOOK_URL}?thread_id=${threadId}`, {
            username: username,
            avatar_url: avatarUrl,
            embeds: embeds
        });

        res.status(200).send(`Test message sent to Discord thread for repo: ${repoName}`);
    } catch (error) {
        console.error('Error in webhook simulation:', error);
        res.status(500).send(`Error: ${error.message}`);
    }
});

// 이슈 이벤트 테스트 엔드포인트
app.get('/simulate-issue', async (req, res) => {
    try {
        const repoName = req.query.repo || 'ollim-web';
        const threadId = REPO_THREAD_MAPPING[repoName] || REPO_THREAD_MAPPING['default'];
        const action = req.query.action || 'opened';

        // 테스트용 사용자 정보
        const username = "9bfish8";
        const avatarUrl = "https://github.com/9bfish8.png";

        // 조직/레포 형식
        const repoFullName = `MIL-LO/${repoName}`;

        // 이슈 제목과 링크
        const issueNumber = 1;
        const issueTitle = "[SET] FE-APP 프로젝트 초기 설정";
        const issueUrl = `https://github.com/${repoFullName}/issues/${issueNumber}`;

        // 임베드 색상 설정
        const color = action === 'opened' ? 5025616 : 15158332; // 열림: 녹색, 닫힘: 빨간색

        // 이슈 설명 (마크다운 형식)
        const description = `## 기능 요약 (Feature Summary)\n\n프론트 앱 부분 초기 설정을 시작합니다.`;

        // 필드 구성
        const fields = [
            {
                name: '🔍 이슈 링크',
                value: `[#${issueNumber}](${issueUrl})`
            }
        ];

        // 임베드 구성
        const embeds = [{
            color: color,
            title: `[${repoFullName}] Issue ${action}: #${issueNumber} ${issueTitle}`,
            url: issueUrl,
            description: description,
            fields: fields
        }];

        // Discord로 메시지 전송 - 사용자 정보 포함
        await axios.post(`${DISCORD_WEBHOOK_URL}?thread_id=${threadId}`, {
            username: username,
            avatar_url: avatarUrl,
            embeds: embeds
        });

        res.status(200).send(`Test issue event sent to Discord thread for repo: ${repoName}`);
    } catch (error) {
        console.error('Error in issue simulation:', error);
        res.status(500).send(`Error: ${error.message}`);
    }
});

// GitHub 웹훅 처리
app.post('/github-webhook', async (req, res) => {
    try {
        console.log('Received webhook request');

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

        // 중복 이벤트 확인
        const eventId = req.headers['x-github-delivery'];
        if (eventId && processedEvents.has(eventId)) {
            console.log(`Duplicate event detected and skipped: ${eventId}`);
            return res.status(200).send('Event already processed');
        }

        // 이벤트 ID 캐시에 추가
        if (eventId) {
            processedEvents.add(eventId);
            if (processedEvents.size > MAX_CACHE_SIZE) {
                const iterator = processedEvents.values();
                processedEvents.delete(iterator.next().value);
            }
        }

        // 레포지토리 이름 추출
        const repoName = payload.repository.name;
        console.log(`Received ${event} event from repository: ${repoName}`);

        // 레포지토리에 해당하는 스레드 ID 찾기
        const threadId = REPO_THREAD_MAPPING[repoName] || REPO_THREAD_MAPPING['default'];

        let title = '';
        let description = '';
        let color = 3447003; // 기본 파란색
        let fields = [];
        let url = '';

        // 이벤트 타입별 메시지 구성
        if (event === 'push') {
            const branch = payload.ref.replace('refs/heads/', '');
            const commitCount = payload.commits ? payload.commits.length : 0;

            title = `[${repoName}:${branch}] ${commitCount} new commit${commitCount !== 1 ? 's' : ''}`;
            url = payload.compare;

            if (payload.commits && payload.commits.length > 0) {
                payload.commits.slice(0, 5).forEach(commit => {
                    const shortHash = commit.id.substring(0, 7);
                    const message = commit.message.split('\n')[0];

                    fields.push({
                        name: `${shortHash} ${message}`,
                        value: `by ${commit.author.name}`
                    });
                });

                if (payload.commits.length > 5) {
                    fields.push({
                        name: '',
                        value: `[+${payload.commits.length - 5} more commits](${payload.compare})`
                    });
                }
            }
        } else if (event === 'pull_request') {
            const action = payload.action;
            const pr = payload.pull_request;

            // 액션에 따른 색상 설정
            if (action === 'opened') {
                color = 5025616; // 녹색
            } else if (action === 'closed') {
                color = pr.merged ? 10181046 : 15158332; // 병합됨(보라색), 닫힘(빨간색)
            }

            title = `[${repoName}] PR ${action}: #${pr.number} ${pr.title}`;
            url = pr.html_url;
            description = pr.body ? (pr.body.length > 1000 ? pr.body.substring(0, 997) + '...' : pr.body) : '';

            fields.push({
                name: pr.title,
                value: `[PR #${pr.number}](${pr.html_url})`
            });
        } else if (event === 'issues') {
            const action = payload.action;
            const issue = payload.issue;
            const issueCreator = issue.user;

            let color;
            switch (action) {
                case 'opened':
                    color = 5025616; // 녹색
                    break;
                case 'closed':
                    color = 15158332; // 빨간색
                    break;
                case 'reopened':
                    color = 16750592; // 주황색
                    break;
                default:
                    color = 3447003; // 파란색
            }

            // 레포지토리 전체 이름 구성 (organization/repo 형식)
            const repoFullName = payload.repository.full_name ||
                (payload.organization ?
                    `${payload.organization.login}/${repoName}` :
                    `MIL-LO/${repoName}`);

            // 이슈 타이틀 구성
            title = `[${repoFullName}] Issue ${action}: #${issue.number} ${issue.title}`;
            url = issue.html_url;

            // 이슈 본문에서 마크다운 포맷을 보존하여 설명으로 변환
            description = issue.body ?
                (issue.body.length > 1000 ? issue.body.substring(0, 997) + '...' : issue.body) :
                '(내용 없음)';

            // 이슈 링크 추가
            fields.push({
                name: '🔍 이슈 링크',
                value: `[#${issue.number}](${issue.html_url})`
            });

            // 라벨 정보 추가 (있는 경우)
            if (issue.labels && issue.labels.length > 0) {
                const labelList = issue.labels
                    .map(label => `\`${label.name}\``)
                    .join(', ');

                fields.push({
                    name: '🏷️ 라벨',
                    value: labelList
                });
            }

            // 담당자 정보 추가 (있는 경우)
            if (issue.assignees && issue.assignees.length > 0) {
                const assigneeList = issue.assignees
                    .map(assignee => `@${assignee.login}`)
                    .join(', ');

                fields.push({
                    name: '👤 담당자',
                    value: assigneeList || '(없음)'
                });
            }

            // 마일스톤 정보 추가 (있는 경우)
            if (issue.milestone) {
                fields.push({
                    name: '🏁 마일스톤',
                    value: issue.milestone.title
                });
            }

            // Discord로 이슈 메시지 전송 - 작성자 이름과 아바타 사용
            await axios.post(`${DISCORD_WEBHOOK_URL}?thread_id=${threadId}`, {
                username: issueCreator.login || "GitHub User",
                avatar_url: issueCreator.avatar_url || "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
                embeds: [{
                    color: color,
                    title: title,
                    url: url,
                    description: description,
                    fields: fields,
                    timestamp: new Date().toISOString()
                }]
            });

            // 응답 전송 후 함수 종료
            console.log(`Successfully sent issue message to Discord thread ${threadId}`);
            return res.status(200).send('Webhook processed');
        } else {
            // 기타 이벤트에 대한 기본 임베드
            title = `[${repoName}] ${event} 이벤트 발생`;
            description = `GitHub에서 ${event} 이벤트가 발생했습니다.`;
        }

        // 이벤트 타입에 따라 적절한 사용자 정보 사용
        let username, avatar_url;

        if (event === 'pull_request') {
            // PR의 경우 작성자 정보 사용
            const eventUser = payload.pull_request.user;
            username = eventUser.login;
            avatar_url = eventUser.avatar_url;
        } else if (event === 'push') {
            // 푸시의 경우 푸시한 사람 정보 사용
            username = payload.pusher.name;
            avatar_url = payload.sender?.avatar_url || `https://github.com/${payload.pusher.name}.png`;
        } else {
            // 기타 이벤트의 경우 발신자 정보 사용
            username = payload.sender?.login || "GitHub User";
            avatar_url = payload.sender?.avatar_url || "https://github.com/identicons/app/png";
        }

        // GitHub 스타일 임베드 메시지 구성
        const embed = {
            color: color,
            title: title,
            url: url,
            description: description,
            fields: fields,
            timestamp: new Date().toISOString()
        };

        // Discord 스레드로 메시지 전송
        await axios.post(`${DISCORD_WEBHOOK_URL}?thread_id=${threadId}`, {
            username: username,
            avatar_url: avatar_url,
            embeds: [embed]
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
