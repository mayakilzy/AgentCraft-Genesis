document.addEventListener('DOMContentLoaded', () => {
  const taskForm = document.getElementById('taskForm');
  const taskContainer = document.getElementById('taskContainer');
  const filterButtons = document.querySelectorAll('.filter-btn');
  
  let currentFilter = 'all';
  
  // Fetch and render tasks
  async function fetchTasks(filter = 'all') {
    try {
      const response = await fetch(`/api/tasks?filter=${filter}`);
      const tasks = await response.json();
      renderTasks(tasks);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    }
  }
  
  // Render tasks in the UI
  function renderTasks(tasks) {
    taskContainer.innerHTML = '';
    
    if (tasks.length === 0) {
      taskContainer.innerHTML = '<p>No tasks found.</p>';
      return;
    }
    
    tasks.forEach(task => {
      const taskElement = document.createElement('div');
      taskElement.className = `task ${task.completed ? 'completed' : ''}`;
      taskElement.dataset.id = task.id;
      
      taskElement.innerHTML = `
        <div class="task-content">
          <h3>${escapeHtml(task.title)}</h3>
          <p>${escapeHtml(task.description)}</p>
        </div>
        <div class="task-actions">
          <button class="btn btn-edit">Edit</button>
          <button class="btn btn-complete">${task.completed ? 'Undo' : 'Complete'}</button>
          <button class="btn btn-delete">Delete</button>
        </div>
      `;
      
      taskContainer.appendChild(taskElement);
    });
    
    // Add event listeners to task buttons
    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', handleEditTask);
    });
    
    document.querySelectorAll('.btn-complete').forEach(btn => {
      btn.addEventListener('click', handleCompleteTask);
    });
    
    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', handleDeleteTask);
    });
  }
  
  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Handle form submission
  taskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const title = document.getElementById('title').value.trim();
    const description = document.getElementById('description').value.trim();
    
    if (!title) return;
    
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, description }),
      });
      
      if (response.ok) {
        taskForm.reset();
        fetchTasks(currentFilter);
      }
    } catch (error) {
      console.error('Error creating task:', error);
    }
  });
  
  // Handle edit task
  function handleEditTask(e) {
    const taskElement = e.target.closest('.task');
    const taskId = taskElement.dataset.id;
    const taskTitle = taskElement.querySelector('h3').textContent;
    const taskDescription = taskElement.querySelector('p').textContent;
    
    const newTitle = prompt('Edit title:', taskTitle);
    if (newTitle === null) return;
    
    const newDescription = prompt('Edit description:', taskDescription);
    if (newDescription === null) return;
    
    updateTask(taskId, newTitle, newDescription);
  }
  
  // Handle complete task
  function handleCompleteTask(e) {
    const taskElement = e.target.closest('.task');
    const taskId = taskElement.dataset.id;
    const isCompleted = taskElement.classList.contains('completed');
    
    updateTask(taskId, null, null, !isCompleted);
  }
  
  // Handle delete task
  function handleDeleteTask(e) {
    const taskElement = e.target.closest('.task');
    const taskId = taskElement.dataset.id;
    
    if (confirm('Are you sure you want to delete this task?')) {
      deleteTask(taskId);
    }
  }
  
  // Update task
  async function updateTask(id, title, description, completed) {
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          title: title || undefined, 
          description: description || undefined, 
          completed 
        }),
      });
      
      if (response.ok) {
        fetchTasks(currentFilter);
      }
    } catch (error) {
      console.error('Error updating task:', error);
    }
  }
  
  // Delete task
  async function deleteTask(id) {
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        fetchTasks(currentFilter);
      }
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  }
  
  // Handle filter buttons
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      fetchTasks(currentFilter);
    });
  });
  
  // Initial load
  fetchTasks(currentFilter);
});