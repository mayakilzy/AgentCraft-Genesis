document.addEventListener('DOMContentLoaded', () => {
  const addTaskForm = document.getElementById('addTaskForm');
  const taskContainer = document.getElementById('taskContainer');
  const filterButtons = document.querySelectorAll('.filter-btn');
  
  let currentFilter = 'all';
  
  // Fetch tasks from the API
  async function fetchTasks(filter = 'all') {
    try {
      const response = await fetch(`/api/tasks?filter=${filter}`);
      if (!response.ok) throw new Error('Failed to fetch tasks');
      return await response.json();
    } catch (error) {
      console.error('Error fetching tasks:', error);
      return [];
    }
  }
  
  // Create a task element
  function createTaskElement(task) {
    const taskElement = document.createElement('div');
    taskElement.className = `task-item ${task.completed ? 'completed' : ''}`;
    taskElement.dataset.id = task.id;
    
    taskElement.innerHTML = `
      <div class="task-content">
        <h3>${task.title}</h3>
        <p>${task.description || ''}</p>
      </div>
      <div class="task-actions">
        <button class="edit-btn">Edit</button>
        <button class="complete-btn">${task.completed ? 'Undo' : 'Complete'}</button>
        <button class="delete-btn">Delete</button>
      </div>
    `;
    
    return taskElement;
  }
  
  // Render tasks
  function renderTasks(tasks) {
    taskContainer.innerHTML = '';
    
    if (tasks.length === 0) {
      taskContainer.innerHTML = '<p>No tasks found.</p>';
      return;
    }
    
    tasks.forEach(task => {
      taskContainer.appendChild(createTaskElement(task));
    });
  }
  
  // Add a new task
  addTaskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const title = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    
    if (!title) return;
    
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, description }),
      });
      
      if (!response.ok) throw new Error('Failed to add task');
      
      // Reset form
      addTaskForm.reset();
      
      // Refresh tasks
      const tasks = await fetchTasks(currentFilter);
      renderTasks(tasks);
    } catch (error) {
      console.error('Error adding task:', error);
    }
  });
  
  // Handle task actions (edit, complete, delete)
  taskContainer.addEventListener('click', async (e) => {
    const taskElement = e.target.closest('.task-item');
    if (!taskElement) return;
    
    const taskId = taskElement.dataset.id;
    
    if (e.target.classList.contains('edit-btn')) {
      const task = await fetchTaskById(taskId);
      if (!task) return;
      
      const newTitle = prompt('Edit title:', task.title);
      if (newTitle === null) return;
      
      const newDescription = prompt('Edit description:', task.description || '');
      if (newDescription === null) return;
      
      try {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: newTitle.trim(),
            description: newDescription.trim(),
            completed: task.completed,
          }),
        });
        
        if (!response.ok) throw new Error('Failed to update task');
        
        // Refresh tasks
        const tasks = await fetchTasks(currentFilter);
        renderTasks(tasks);
      } catch (error) {
        console.error('Error updating task:', error);
      }
    } else if (e.target.classList.contains('complete-btn')) {
      const task = await fetchTaskById(taskId);
      if (!task) return;
      
      try {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: task.title,
            description: task.description || '',
            completed: !task.completed,
          }),
        });
        
        if (!response.ok) throw new Error('Failed to update task');
        
        // Refresh tasks
        const tasks = await fetchTasks(currentFilter);
        renderTasks(tasks);
      } catch (error) {
        console.error('Error updating task:', error);
      }
    } else if (e.target.classList.contains('delete-btn')) {
      if (!confirm('Are you sure you want to delete this task?')) return;
      
      try {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: 'DELETE',
        });
        
        if (!response.ok) throw new Error('Failed to delete task');
        
        // Refresh tasks
        const tasks = await fetchTasks(currentFilter);
        renderTasks(tasks);
      } catch (error) {
        console.error('Error deleting task:', error);
      }
    }
  });
  
  // Fetch a single task by ID
  async function fetchTaskById(id) {
    try {
      const response = await fetch(`/api/tasks/${id}`);
      if (!response.ok) throw new Error('Failed to fetch task');
      return await response.json();
    } catch (error) {
      console.error('Error fetching task:', error);
      return null;
    }
  }
  
  // Handle filter buttons
  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Update active button
      filterButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Update current filter and fetch tasks
      currentFilter = button.dataset.filter;
      const tasks = fetchTasks(currentFilter);
      renderTasks(tasks);
    });
  });
  
  // Initial load
  const tasks = await fetchTasks(currentFilter);
  renderTasks(tasks);
});