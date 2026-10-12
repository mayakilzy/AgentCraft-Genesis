document.addEventListener('DOMContentLoaded', () => {
  const taskForm = document.getElementById('taskForm');
  const taskContainer = document.getElementById('taskContainer');
  const filterButtons = document.querySelectorAll('.filter');
  
  let currentFilter = 'all';
  
  // Fetch tasks from the API
  const fetchTasks = async () => {
    try {
      const response = await fetch('/api/tasks');
      const tasks = await response.json();
      renderTasks(tasks);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    }
  };
  
  // Render tasks based on current filter
  const renderTasks = (tasks) => {
    let filteredTasks = tasks;
    
    if (currentFilter === 'active') {
      filteredTasks = tasks.filter(task => !task.completed);
    } else if (currentFilter === 'completed') {
      filteredTasks = tasks.filter(task => task.completed);
    }
    
    taskContainer.innerHTML = '';
    
    if (filteredTasks.length === 0) {
      taskContainer.innerHTML = '<p>No tasks found.</p>';
      return;
    }
    
    filteredTasks.forEach(task => {
      const taskElement = document.createElement('div');
      taskElement.className = `task ${task.completed ? 'completed' : ''}`;
      taskElement.innerHTML = `
        <div class="task-content">
          <h3>${task.title}</h3>
          <p>${task.description}</p>
        </div>
        <div class="task-actions">
          <button class="edit-btn" data-id="${task.id}">Edit</button>
          <button class="toggle-btn" data-id="${task.id}">${task.completed ? 'Active' : 'Complete'}</button>
          <button class="delete-btn" data-id="${task.id}">Delete</button>
        </div>
      `;
      taskContainer.appendChild(taskElement);
    });
    
    // Add event listeners to task buttons
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', handleEditTask);
    });
    
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', handleToggleTask);
    });
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', handleDeleteTask);
    });
  };
  
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
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title, description })
      });
      
      if (response.ok) {
        taskForm.reset();
        fetchTasks();
      } else {
        console.error('Error creating task');
      }
    } catch (error) {
      console.error('Error creating task:', error);
    }
  });
  
  // Handle edit task
  const handleEditTask = async (e) => {
    const id = e.target.dataset.id;
    
    try {
      const response = await fetch(`/api/tasks/${id}`);
      const task = await response.json();
      
      // Fill form with task data
      document.getElementById('title').value = task.title;
      document.getElementById('description').value = task.description;
      
      // Change form button to update
      const submitBtn = taskForm.querySelector('button[type="submit"]');
      submitBtn.textContent = 'Update Task';
      
      // Store task ID for update
      taskForm.dataset.taskId = id;
      
      // Change form submit handler
      taskForm.onsubmit = async (e) => {
        e.preventDefault();
        
        const title = document.getElementById('title').value.trim();
        const description = document.getElementById('description').value.trim();
        
        if (!title) return;
        
        try {
          const updateResponse = await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title, description })
          });
          
          if (updateResponse.ok) {
            taskForm.reset();
            submitBtn.textContent = 'Add Task';
            delete taskForm.dataset.taskId;
            taskForm.onsubmit = null;
            fetchTasks();
          } else {
            console.error('Error updating task');
          }
        } catch (error) {
          console.error('Error updating task:', error);
        }
      };
    } catch (error) {
      console.error('Error fetching task for edit:', error);
    }
  };
  
  // Handle toggle task completion
  const handleToggleTask = async (e) => {
    const id = e.target.dataset.id;
    
    try {
      // First get the task to get current completion status
      const response = await fetch(`/api/tasks/${id}`);
      const task = await response.json();
      
      // Toggle completion status
      const completed = !task.completed;
      
      const updateResponse = await fetch(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ completed })
      });
      
      if (updateResponse.ok) {
        fetchTasks();
      } else {
        console.error('Error toggling task completion');
      }
    } catch (error) {
      console.error('Error toggling task completion:', error);
    }
  };
  
  // Handle delete task
  const handleDeleteTask = async (e) => {
    const id = e.target.dataset.id;
    
    if (!confirm('Are you sure you want to delete this task?')) return;
    
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        fetchTasks();
      } else {
        console.error('Error deleting task');
      }
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };
  
  // Handle filter buttons
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active filter
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      
      // Re-render tasks
      fetchTasks();
    });
  });
  
  // Initial fetch
  fetchTasks();
});