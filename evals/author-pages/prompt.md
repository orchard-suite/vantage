---
max_turns: 25
allowed_tools: [Read, Glob, Grep, Write, Edit, Skill, Bash(bun *), Bash(mkdir *)]
tags: [author, pages]
---

Make the folder /tmp/vantage-eval/payments and write this Vantage document to /tmp/vantage-eval/payments/payments.vantage.yaml exactly as given:

```yaml
title: Payments
nodes:
  - name: Customers
    type: users
  - id: vnet
    name: Payments Network
    type: network
    facts: ["Address: 10.40.0.0/16", "Region: eastus2"]
    children:
      - name: Checkout API
        type: api
        subtitle: ASP.NET 10
        facts: ["Plan: P2v3", "Instances: 3"]
      - name: Payments DB
        type: database
        subtitle: Azure SQL
        facts: ["SKU: GP_Gen5_4", "Backup: 35 days"]
      - name: Retry Queue
        type: queue
        subtitle: Service Bus
  - name: Card Processor
    type: external
relations:
  - { from: customers, to: checkout-api, label: pays, tags: [requests] }
  - { from: checkout-api, to: card-processor, label: charges the card, tags: [requests] }
  - { from: checkout-api, to: payments-db, label: records the payment, kind: data, tags: [requests] }
  - { from: checkout-api, to: retry-queue, label: queues a failed charge, kind: async, tags: [requests] }
views:
  - id: requests
    title: How a Payment Flows
    question: What happens when a customer pays?
    include: { tags: [requests] }
```

Then add a guide page for on-call engineers, kept beside the requests view, that explains how a payment flows, where the API runs and on what network, how big the database is, and what to check when a charge fails. Check the document with the CLI at packages/cli/src/main.ts in this repository (lint), and render the requests view to look at it, before you finish.
