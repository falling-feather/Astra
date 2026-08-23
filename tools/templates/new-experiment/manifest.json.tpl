{
  "schema_version": 1,
  "subject": "__SUBJECT__",
  "id": "__EXPERIMENT_ID__",
  "activity_key": "__SUBJECT__.__EXPERIMENT_ID__",
  "route": "#__SUBJECT__/__EXPERIMENT_ID__",
  "title": "__EXPERIMENT_TITLE__",
  "owner": "__OWNER__",
  "namespace": "astra-exp--__NAMESPACE__",
  "script": "pages/__SUBJECT__/__EXPERIMENT_ID__/index.js?v=__ASSET_VERSION__",
  "style": "pages/__SUBJECT__/__EXPERIMENT_ID__/styles.css?v=__ASSET_VERSION__",
  "preview": {
    "record": "pages/__SUBJECT__/__EXPERIMENT_ID__/preview.json",
    "poster": "pages/__SUBJECT__/__EXPERIMENT_ID__/preview.webp?v=__ASSET_VERSION__",
    "alt": "__PREVIEW_ALT__",
    "motion": null,
    "reduced_motion": "poster"
  },
  "init_hook": "init__OWNER__",
  "cleanup": {
    "owner": "__OWNER__",
    "method": "destroy",
    "verified": true
  },
  "model_document": "doc/01-子文档/15-学科实验与内容开发指南.md#model-__EXPERIMENT_ID__",
  "registration_state": "candidate-unregistered"
}
