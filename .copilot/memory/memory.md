# Aware Extension Memory

## Work IQ Tool Name (CRITICAL)
Must use exact tool name `mcp_workiq_ask_work_iq`. Fuzzy matching picks wrong tools like `mcp_workiq_accept_eula`.

## Query Format for Structured JSON
Both meetingService and documentService use structured prompts requesting JSON:
- Meetings: `What are ALL my meetings for today? Return as JSON array with fields: title, startTime, endTime, onlineJoinUrl`
- Documents: `What documents are related to "{repoName}"? Return as JSON array with fields: title, url, type`

## Response Parsing Pattern
Work IQ returns JSON in markdown code fences with footnotes for real URLs:
```json
[{"title": "Doc", "url": "[1]", "type": "Word"}]
```
[1](https://actual-url.com)

Parse steps:
1. Extract footnote URLs with regex: `/\[(\d+)\]\((https?:\/\/[^)]+)\)/g`
2. Extract JSON from code fences: `/```(?:json)?\s*([\s\S]*?)```/`
3. Map footnote index to real URL
