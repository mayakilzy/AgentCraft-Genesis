document.addEventListener('DOMContentLoaded', () => {
  const taskForm = document.getElementById('taskForm');
  const taskContainer = document.getElementById('taskContainer');
  const filterButtons = document.querySelectorAll('.filter-btn');
  
  let currentFilter = 'all';
  
  // Form submission
  taskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const title = document.getElementById('title').value.trim();
    const description = document.getElementById('description').value.trim();
    
    if (!title) return;
    
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title, description })
      });
      
      if (response.ok) {
        taskForm.reset();
        fetchTasks();
      } else {
        console.error('Failed to create task');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  });
  
  // Filter buttons
  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      filterButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      currentFilter = button.dataset.filter;
      fetchTasks();
    });
  });
  
  // Fetch tasks
  async function fetchTasks() {
    try {
      const response = await fetch(`/api/tasks?filter=${currentFilter}`);
      const tasks = await response.json();
      renderTasks(tasks);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    }
  }
  
  // Render tasks
  function renderTasks(tasks) {
    taskContainer.innerHTML = '';
    
    if (tasks.length === 0) {
      taskContainer.innerHTML = '<p>No tasks found</p>';
      return;
    }
    
    tasks.forEach(task => {
      const taskElement = document.createElement('div');
      taskElement.className = `task-item ${task.completed ? 'completed' : ''}`;
      taskElement.innerHTML = `
        <div class="task-content">
          <h3>${escapeHtml(task.title)}</h3>
          <p>${escapeHtml(task.description || '')}</p>
        </div>
        <div class="task-actions">
          <button class="edit-btn" data-id="${task.id}">Edit</button>
          <button class="complete-btn" data-id="${task.id}">${task.completed ? 'Undo' : 'Complete'}</button>
          <button class="delete-btn" data-id="${task.id}">Delete</button>
        </div>
      `;
      
      taskContainer.appendChild(taskElement);
    });
    
    // Add event listeners to buttons
    document.querySelectorAll('.edit-btn').forEach(button => {
      button.addEventListener('click', handleEdit);
    });
    
    document.querySelectorAll('.complete-btn').forEach(button => {
      button.addEventListener('click', handleComplete);
    });
    
    document.querySelectorAll('.delete-btn').forEach(button => {
      button.addEventListener('click', handleDelete);
    });
  }
  
  // Handle edit
  async function handleEdit(e) {
    const id = e.target.dataset.id;
    const task = await fetchTaskById(id);
    
    if (!task) return;
    
    const newTitle = prompt('Edit title:', task.title);
    if (newTitle === null) return;
    
    const newDescription = prompt('Edit description:', task.description || '');
    if (newDescription === null) return;
    
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim(),
          completed: task.completed
        })
      });
      
      if (response.ok) {
        fetchTasks();
      } else {
        console.error('Failed to update task');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  }
  
  // Handle complete
  async function handleComplete(e) {
    const id = e.target.dataset.id;
    const task = await fetchTaskById(id);
    
    if (!task) return;
    
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: task.title,
          description: task.description,
          completed: !task.completed
        })
      });
      
      if (response.ok) {
        fetchTasks();
      } else {
        console.error('Failed to update task');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  }
  
  // Handle delete
  async function handleDelete(e) {
    const id = e.target.dataset.id;
    
    if (!confirm('Are you sure you want to delete this task?')) return;
    
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        fetchTasks();
      } else {
        console.error('Failed to delete task');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  }
  
  // Fetch single task by ID
  async function fetchTaskById(id) {
    try {
      const response = await fetch(`/api/tasks/${id}`);
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error('Error fetching task:', error);
      return null;
    }
  }
  
  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"]/g, m => map[m]);
  }
  
  // Initial fetch
  fetchTasks();
});