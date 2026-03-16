"""Snake Game using Python's curses library. No external dependencies required."""

import curses
import random

def main(stdscr):
    # Setup
    curses.curs_set(0)
    stdscr.nodelay(True)
    stdscr.timeout(100)

    # Get screen dimensions
    sh, sw = stdscr.getmaxyx()

    # Create game window
    win = curses.newwin(sh, sw, 0, 0)
    win.keypad(True)
    win.timeout(100)

    # Initial snake position (middle of screen)
    snake_y = sh // 2
    snake_x = sw // 4
    snake = [
        [snake_y, snake_x],
        [snake_y, snake_x - 1],
        [snake_y, snake_x - 2],
    ]

    # Initial food position
    food = [sh // 2, sw // 2]
    win.addch(food[0], food[1], curses.ACS_PI)

    # Initial direction (moving right)
    direction = curses.KEY_RIGHT
    score = 0

    while True:
        # Show score
        win.addstr(0, 2, f" Score: {score} ")

        # Get next key press
        next_key = win.getch()

        # Determine direction (prevent reversing)
        if next_key == -1:
            key = direction
        else:
            key = next_key

        opposite_keys = {
            curses.KEY_UP: curses.KEY_DOWN,
            curses.KEY_DOWN: curses.KEY_UP,
            curses.KEY_LEFT: curses.KEY_RIGHT,
            curses.KEY_RIGHT: curses.KEY_LEFT,
        }
        if key in opposite_keys and opposite_keys[key] == direction:
            key = direction

        if key in [curses.KEY_UP, curses.KEY_DOWN, curses.KEY_LEFT, curses.KEY_RIGHT]:
            direction = key

        # Quit on 'q'
        if next_key == ord("q"):
            break

        # Calculate new head position
        head = snake[0]
        if direction == curses.KEY_UP:
            new_head = [head[0] - 1, head[1]]
        elif direction == curses.KEY_DOWN:
            new_head = [head[0] + 1, head[1]]
        elif direction == curses.KEY_LEFT:
            new_head = [head[0], head[1] - 1]
        elif direction == curses.KEY_RIGHT:
            new_head = [head[0], head[1] + 1]

        # Check for collisions (wall or self)
        if (
            new_head[0] <= 0
            or new_head[0] >= sh - 1
            or new_head[1] <= 0
            or new_head[1] >= sw - 1
            or new_head in snake
        ):
            # Game over
            win.addstr(sh // 2, sw // 2 - 5, "GAME OVER!")
            win.addstr(sh // 2 + 1, sw // 2 - 8, f"Final Score: {score}")
            win.addstr(sh // 2 + 2, sw // 2 - 10, "Press any key to exit")
            win.nodelay(False)
            win.getch()
            break

        # Insert new head
        snake.insert(0, new_head)

        # Check if food is eaten
        if new_head == food:
            score += 1
            # Speed up slightly
            win.timeout(max(50, 100 - score * 2))
            # Place new food
            while True:
                food = [
                    random.randint(1, sh - 2),
                    random.randint(1, sw - 2),
                ]
                if food not in snake:
                    break
            win.addch(food[0], food[1], curses.ACS_PI)
        else:
            # Remove tail
            tail = snake.pop()
            win.addch(tail[0], tail[1], " ")

        # Draw snake head
        win.addch(snake[0][0], snake[0][1], curses.ACS_CKBOARD)


if __name__ == "__main__":
    curses.wrapper(main)
