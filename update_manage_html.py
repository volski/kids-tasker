import re

with open('frontend/src/app/parent/manage-tab/manage-tab.component.html', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace('(change)="handleUpdateTask(child.id, task, true)"', ' (change)="handleUpdateTask(child.id, task.id, { icon: task.icon }, true)"')
text = text.replace('(blur)="handleUpdateTask(child.id, task, true)"', ' (blur)="handleUpdateTask(child.id, task.id, { title: task.title }, true)"')
text = text.replace('(keyup.enter)="handleUpdateTask(child.id, task)"', ' (keyup.enter)="handleUpdateTask(child.id, task.id, { title: task.title })"')
text = text.replace('(change)="handleUpdateTask(child.id, task, true)"', ' (change)="handleUpdateTask(child.id, task.id, { audioFeedback: task.audioFeedback }, true)"')
text = text.replace('(change)="handleUpdateTask(child.id, task, true)"', ' (change)="handleUpdateTask(child.id, task.id, { requiresApproval: task.requiresApproval }, true)"')
text = text.replace('(change)="handleUpdateTask(child.id, task, true)"', ' (change)="handleUpdateTask(child.id, task.id, { enabled: task.enabled }, true)"')
text = text.replace('(click)="handleUpdateTask(child.id, task)"', ' (click)="handleUpdateTask(child.id, task.id, { title: task.title, icon: task.icon, requiresApproval: task.requiresApproval, audioFeedback: task.audioFeedback, enabled: task.enabled })"')

with open('frontend/src/app/parent/manage-tab/manage-tab.component.html', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated manage-tab.component.html")
