export const STARTER = `title: My System Architecture
author: Your Name
updated: 2026-01-01

nodes:
  - name: Users
    type: users
  - id: cloud
    name: Cloud
    type: cloud
    children:
      - name: Web App
        type: web
      - name: API
        type: api
      - name: Database
        type: database

relations:
  - from: users
    to: web-app
    label: uses
    tags: [requests]
  - from: web-app
    to: api
    label: calls
    tags: [requests]
  - from: api
    to: database
    label: reads and writes
    kind: data
    tags: [data]

views:
  - id: context
    title: Context
    question: Who uses the system and what does it store?
    include: { tags: [requests, data] }
`;
