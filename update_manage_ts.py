import re

with open('frontend/src/app/parent/manage-tab/manage-tab.component.ts', 'r', encoding='utf-8') as f:
    text = f.read()

old_handle = """  async handleUpdateTask(childId: string, task: Task, silent = false) {
    if (!task.title.trim()) return;

    this.savingTasks.add(task.id);
    try {
      const res = await fetch(`/api/children/${childId}/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: task.title,
          icon: task.icon,
          requiresApproval: task.requiresApproval,
          audioFeedback: task.audioFeedback,
          enabled: task.enabled
        })
      });
      if (!res.ok) throw new Error('Failed to update task');
      
      if (!silent) this.shell.showToast(`משימה "${task.title}" עודכנה בהצלחה!`);
      // Update data so it doesn't revert while polling
      this.taskService.loadData().subscribe();
    } catch (err: any) {
      if (!silent) this.shell.showToast('שגיאה בעדכון משימה: ' + err.message, 'error');
    } finally {
      this.savingTasks.delete(task.id);
    }
  }"""

new_handle = """  async handleUpdateTask(childId: string, taskId: string, patch: Partial<Task>, silent = false) {
    if (patch.title !== undefined && !patch.title.trim()) return;

    this.savingTasks.add(taskId);
    try {
      const res = await fetch(`/api/children/${childId}/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!res.ok) throw new Error('Failed to update task');
      
      const data = await res.json();
      if (data.task) {
        this.taskService.applyTaskDelta({
          childId,
          taskId,
          changes: patch
        });
      }
      
      if (!silent) this.shell.showToast('משימה עודכנה בהצלחה!');
    } catch (err: any) {
      if (!silent) this.shell.showToast('שגיאה בעדכון משימה: ' + err.message, 'error');
    } finally {
      this.savingTasks.delete(taskId);
    }
  }"""

text = text.replace(old_handle, new_handle)

with open('frontend/src/app/parent/manage-tab/manage-tab.component.ts', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated manage-tab.component.ts")
