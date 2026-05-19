import { Avatar, Button, Card } from "@chakra-ui/react"
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";

const RelCard = (props) => {

  let navigate = useNavigate();

  return (
    <Card.Root width="320px">
      <Card.Body gap="2">
        <Avatar.Root size="lg" shape="rounded">
          {/* <Avatar.Image src="https://picsum.photos/200/300" /> */}
        {props.icon}
          {/* <Avatar.Fallback name="Nue Camp" /> */}
        </Avatar.Root>
        <Card.Title mt="2">{props.title}</Card.Title>
        <Card.Description>
          {props.description}
        </Card.Description>
      </Card.Body>
      <Card.Footer justifyContent="flex-end">
        <Button onClick={()=>{navigate(props.to)}}>
          {props.button}
        </Button>
      </Card.Footer>
    </Card.Root>
  )
}

export default RelCard
